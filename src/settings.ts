import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId, type Db } from "mongodb";
import { requireUser, TOO_MANY_LOGINS, type Auth } from "./auth.js";
import type { Clock } from "./clock.js";
import { sendConfirmPage } from "./confirm.js";
import { setFlash } from "./flash.js";
import { formatDateTime } from "./format.js";
import { csrfField, html, timeZoneOptions } from "./html.js";
import {
  addAlertChannel,
  alertChannels,
  AlertChannelLimitError,
  CHANNEL_KIND_LABELS,
  findAlertChannel,
  listAlertChannels,
  MAX_CHANNEL_NAME_LENGTH,
  removeAlertChannel,
  renameAlertChannel,
  validChannelName,
  type AlertChannelDoc,
} from "./alert-channels.js";
import type { KeyedLock } from "./keyed-lock.js";
import { limitsFor } from "./limits.js";
import {
  checkOutboundUrl,
  MAX_OUTBOUND_URL_LENGTH,
  OutboundUrlError,
  type HostResolver,
} from "./outbound-http.js";
import type { AlertSenders } from "./alerts.js";
import { createLinkCode, findActiveLinkCode } from "./linked-chats.js";
import { SlidingWindowLimiter } from "./rate-limit.js";
import { testAlertChannel } from "./test-alert.js";
import {
  authenticate,
  isTheme,
  MIN_PASSWORD_LENGTH,
  setUserPassword,
  setUserTheme,
  setUserTimeZone,
  UserError,
} from "./users.js";

/** Only same-site paths, so the switch can't be turned into an open redirect. */
function localPath(value: unknown): string {
  return typeof value === "string" && /^\/(?![/\\])/.test(value) ? value : "/";
}

/** Longest Webhook secret, in characters. */
const MAX_SECRET_LENGTH = 200;

/** A form field as a string; "" when missing. */
const formField = (body: unknown, name: string): string => {
  const value = (body as Record<string, unknown> | undefined)?.[name];
  return typeof value === "string" ? value : "";
};

/** The rest of a channel's row: what it points at and, when Failing, since when and why. */
function channelDetails(channel: AlertChannelDoc, timeZone: string) {
  const failing = channel.failingSince
    ? html`<span class="badge badge-down">Failing</span>
        <small class="channel-error"
          >since ${formatDateTime(channel.failingSince, timeZone)}:
          ${channel.lastError ?? "unknown error"}</small
        >`
    : "";
  if (channel.kind !== "webhook") return failing;
  return html`<small class="channel-target"
      ><code>${channel.url}</code>,
      ${channel.secret ? "secret set" : "no secret"}</small
    >
    ${failing}
    <a
      href="/settings/channels/${String(channel._id)}/webhook"
      class="button secondary"
      >Edit</a
    >`;
}

/** Link codes a User may generate per hour. */
const LINK_CODE_MAX = 10;
const LINK_CODE_WINDOW_MS = 60 * 60 * 1000;
/** Test Alerts a User may send per minute. */
const TEST_ALERT_MAX = 5;
const TEST_ALERT_WINDOW_MS = 60 * 1000;

export function registerSettings(
  app: FastifyInstance,
  deps: {
    db: Db;
    clock: Clock;
    auth: Auth;
    senders: AlertSenders;
    /** Guards the per-User Alert channel limit, shared with linking a Telegram chat. */
    channelLock: KeyedLock;
    resolveHost: HostResolver;
    publicBaseUrl: string;
  },
): void {
  const { db, clock, auth, senders, channelLock, resolveHost, publicBaseUrl } =
    deps;
  const testAlertsPerUser = new SlidingWindowLimiter(
    clock,
    TEST_ALERT_MAX,
    TEST_ALERT_WINDOW_MS,
  );
  const linkCodesPerUser = new SlidingWindowLimiter(
    clock,
    LINK_CODE_MAX,
    LINK_CODE_WINDOW_MS,
  );

  const settingsPage = async (
    req: FastifyRequest,
    reply: FastifyReply,
    options: {
      passwordError?: string;
      linkCodeError?: string;
      channelError?: string;
      webhookError?: string;
      webhookForm?: { name: string; url: string };
    } = {},
  ) => {
    const user = req.user!;
    const csrf = auth.csrfToken(req, reply);
    const [code, channels] = await Promise.all([
      findActiveLinkCode(db, user._id, clock.now()),
      listAlertChannels(db, user._id),
    ]);
    return reply.page({
      title: "Settings",
      body: html`<h1>Settings</h1>
        <h2>Time zone</h2>
        <form method="post" action="/settings/time-zone">
          ${csrfField(csrf)}
          <label
            >Times are shown in
            <select name="timeZone">
              ${timeZoneOptions(user.timeZone)}
            </select></label
          >
          <button type="submit">Save time zone</button>
        </form>
        <h2>Alert channels</h2>
        ${
          options.channelError
            ? html`<p class="error">${options.channelError}</p>`
            : ""
        }
        ${
          channels.length === 0
            ? html`<p>No Alert channels yet.</p>`
            : html`<ul class="plain alert-channels">
                ${channels.map((c) => {
                  const path = `/settings/channels/${String(c._id)}`;
                  return html`<li>
                    <span class="channel-kind"
                      >${CHANNEL_KIND_LABELS[c.kind]}</span
                    >
                    <form method="post" action="${path}/rename">
                      ${csrfField(csrf)}
                      <input
                        type="text"
                        name="name"
                        value="${c.name}"
                        aria-label="Name"
                        maxlength="${String(MAX_CHANNEL_NAME_LENGTH)}"
                        required
                      />
                      <button type="submit" class="secondary">Rename</button>
                    </form>
                    <small
                      >added
                      ${formatDateTime(c.createdAt, user.timeZone)}</small
                    >
                    ${channelDetails(c, user.timeZone)}
                    <form method="post" action="${path}/test">
                      ${csrfField(csrf)}
                      <button type="submit" class="secondary">Send test</button>
                    </form>
                    <a href="${path}/delete" class="button secondary">Remove</a>
                  </li>`;
                })}
              </ul>`
        }
        <h2>Add a Webhook</h2>
        <p>
          Alerts are POSTed to the URL as JSON. With a secret, each request is
          signed in the <code>X-Nodbeat-Signature</code> header; see the
          <a href="/docs">API docs</a>.
        </p>
        ${
          options.webhookError
            ? html`<p class="error">${options.webhookError}</p>`
            : ""
        }
        <form method="post" action="/settings/webhooks">
          ${csrfField(csrf)}
          <label
            >Name (optional)
            <input
              type="text"
              name="name"
              value="${options.webhookForm?.name ?? ""}"
              maxlength="${String(MAX_CHANNEL_NAME_LENGTH)}"
          /></label>
          <label
            >URL
            <input
              type="url"
              name="url"
              value="${options.webhookForm?.url ?? ""}"
              maxlength="${String(MAX_OUTBOUND_URL_LENGTH)}"
              placeholder="https://"
              required
          /></label>
          <label
            >Secret (optional)
            <input
              type="password"
              name="secret"
              autocomplete="off"
              maxlength="${String(MAX_SECRET_LENGTH)}"
          /></label>
          <button type="submit">Add Webhook</button>
        </form>
        <h2>Link a Telegram chat</h2>
        ${
          code
            ? html`<p>
                Send
                <code>/start <code class="link-code">${code._id}</code></code>
                to the nodbeat bot in the chat you want to link (private or
                group). The code works once and expires at
                ${formatDateTime(code.expiresAt, user.timeZone)}.
              </p>`
            : ""
        }
        ${
          options.linkCodeError
            ? html`<p class="error">${options.linkCodeError}</p>`
            : ""
        }
        <form method="post" action="/settings/link-code">
          ${csrfField(csrf)}
          <button type="submit">Generate Link code</button>
        </form>
        <h2 id="password">Password</h2>
        ${
          options.passwordError
            ? html`<p class="error">${options.passwordError}</p>`
            : ""
        }
        <form method="post" action="/settings/password">
          ${csrfField(csrf)}
          <input
            type="text"
            name="username"
            value="${user.email}"
            autocomplete="username"
            hidden
          />
          <label
            >Current password
            <input
              type="password"
              name="current"
              autocomplete="current-password"
              required
          /></label>
          <label
            >New password (at least ${String(MIN_PASSWORD_LENGTH)} characters)
            <input
              type="password"
              name="password"
              autocomplete="new-password"
              minlength="${String(MIN_PASSWORD_LENGTH)}"
              required
          /></label>
          <label
            >New password again
            <input
              type="password"
              name="confirm"
              autocomplete="new-password"
              required
          /></label>
          <button type="submit">Change password</button>
        </form>
        <p>Changing your password logs you out everywhere else.</p>
        <h2>Sessions</h2>
        <form method="post" action="/logout-everywhere">
          ${csrfField(csrf)}
          <button type="submit" class="secondary">Log out everywhere</button>
        </form>
        <p>Ends every session, on every device, this one included.</p>`,
    });
  };

  app.get("/settings", { preHandler: requireUser }, (req, reply) =>
    settingsPage(req, reply),
  );

  app.post(
    "/settings/password",
    { preHandler: requireUser },
    async (req, reply) => {
      const user = req.user!;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const field = (name: string) =>
        typeof body[name] === "string" ? body[name] : "";
      const fail = (status: number, passwordError: string) => {
        reply.code(status);
        return settingsPage(req, reply, { passwordError });
      };

      const attempt = auth.takeLoginAttempt(req.ip, user.email);
      if (!attempt) return fail(429, TOO_MANY_LOGINS);
      if (!(await authenticate(db, user.email, field("current")))) {
        return fail(400, "Current password is wrong.");
      }
      attempt.succeeded();
      if (field("password") !== field("confirm")) {
        return fail(400, "The new passwords don't match.");
      }
      try {
        await setUserPassword(db, user._id, field("password"));
      } catch (err) {
        if (!(err instanceof UserError)) throw err;
        return fail(400, `${err.message}.`);
      }
      await auth.endOtherSessions(req, user._id);
      setFlash(reply, "Password changed.");
      return reply.redirect("/settings", 303);
    },
  );

  app.post(
    "/settings/time-zone",
    { preHandler: requireUser },
    async (req, reply) => {
      const value = (req.body as Record<string, unknown> | undefined)?.timeZone;
      const ok =
        typeof value === "string" &&
        (await setUserTimeZone(db, req.user!._id, value));
      if (!ok) {
        return reply.errorPage(400, { message: "Unknown time zone." });
      }
      setFlash(reply, "Time zone saved.");
      return reply.redirect("/settings", 303);
    },
  );

  app.post(
    "/settings/theme",
    { preHandler: requireUser },
    async (req, reply) => {
      const body = req.body as Record<string, unknown> | undefined;
      const theme = body?.theme;
      if (!isTheme(theme)) {
        return reply.errorPage(400, { message: "Unknown theme." });
      }
      await setUserTheme(db, req.user!._id, theme);
      // `assets/theme.js` asks for JSON and applies the theme without a reload.
      if (req.headers.accept?.includes("application/json")) {
        return reply.send({ theme });
      }
      return reply.redirect(localPath(body?.back), 303);
    },
  );

  app.post(
    "/settings/link-code",
    { preHandler: requireUser },
    async (req, reply) => {
      if (!linkCodesPerUser.tryAcquire(String(req.user!._id))) {
        reply.code(429);
        return settingsPage(req, reply, {
          linkCodeError: "Too many Link codes. Try again later.",
        });
      }
      await createLinkCode(db, req.user!._id, clock.now());
      return reply.redirect("/settings", 303);
    },
  );

  /** The URL once safe to send to, or the reason it isn't. */
  const checkUrl = async (
    value: string,
  ): Promise<{ url: string } | { error: string }> => {
    try {
      return { url: (await checkOutboundUrl(value.trim(), resolveHost)).href };
    } catch (err) {
      if (err instanceof OutboundUrlError) return { error: err.message };
      throw err;
    }
  };

  /** null for none, false when too long. */
  const validSecret = (value: string): string | null | false =>
    value.length === 0 ? null : value.length <= MAX_SECRET_LENGTH && value;
  const SECRET_TOO_LONG = `A secret can have at most ${MAX_SECRET_LENGTH} characters.`;

  app.post(
    "/settings/webhooks",
    { preHandler: requireUser },
    async (req, reply) => {
      const user = req.user!;
      const rawName = formField(req.body, "name");
      const rawUrl = formField(req.body, "url");
      const fail = (webhookError: string) => {
        reply.code(400);
        return settingsPage(req, reply, {
          webhookError,
          webhookForm: { name: rawName, url: rawUrl },
        });
      };
      const checked = await checkUrl(rawUrl);
      if ("error" in checked) return fail(checked.error);
      // Unnamed: called after its host.
      const name =
        rawName.trim() === ""
          ? new URL(checked.url).hostname
          : validChannelName(rawName);
      if (!name) {
        return fail(`A name needs 1 to ${MAX_CHANNEL_NAME_LENGTH} characters.`);
      }
      const secret = validSecret(formField(req.body, "secret"));
      if (secret === false) return fail(SECRET_TOO_LONG);
      try {
        await addAlertChannel(
          db,
          channelLock,
          {
            _id: new ObjectId(),
            ownerId: user._id,
            kind: "webhook",
            name,
            url: checked.url,
            secret,
            createdAt: clock.now(),
            failingSince: null,
            lastError: null,
          },
          { limit: limitsFor(user).maxAlertChannels },
        );
      } catch (err) {
        if (!(err instanceof AlertChannelLimitError)) throw err;
        return fail(`${err.message} Remove one first.`);
      }
      setFlash(reply, `Webhook ${name} added.`);
      return reply.redirect("/settings", 303);
    },
  );

  const findWebhook = async (ownerId: ObjectId, id: string) => {
    const channel = await findAlertChannel(db, ownerId, id);
    return channel?.kind === "webhook" ? channel : null;
  };

  /** Edits a Webhook's URL and secret; the secret itself is never shown. */
  const webhookPage = (
    req: FastifyRequest,
    reply: FastifyReply,
    channel: { _id: ObjectId; name: string; secret: string | null },
    url: string,
    error?: string,
  ) =>
    reply.page({
      title: `Edit ${channel.name}`,
      body: html`<h1>Edit Webhook ${channel.name}</h1>
        ${error ? html`<p class="error">${error}</p>` : ""}
        <form
          method="post"
          action="/settings/channels/${String(channel._id)}/webhook"
        >
          ${csrfField(auth.csrfToken(req, reply))}
          <label
            >URL
            <input
              type="url"
              name="url"
              value="${url}"
              maxlength="${String(MAX_OUTBOUND_URL_LENGTH)}"
              required
          /></label>
          <label
            >Secret
            <input
              type="password"
              name="secret"
              autocomplete="off"
              maxlength="${String(MAX_SECRET_LENGTH)}"
              placeholder="${channel.secret ? "secret set" : "no secret"}"
          /></label>
          <p>
            ${
              channel.secret
                ? "Secret set. Leave empty to keep it, or type a new one."
                : "No secret: requests aren't signed."
            }
          </p>
          ${
            channel.secret
              ? html`<label
                  ><input type="checkbox" name="removeSecret" value="1" />
                  Remove the secret</label
                >`
              : ""
          }
          <button type="submit">Save Webhook</button>
          <a href="/settings" class="button secondary">Cancel</a>
        </form>`,
    });

  app.get<{ Params: { id: string } }>(
    "/settings/channels/:id/webhook",
    { preHandler: requireUser },
    async (req, reply) => {
      const channel = await findWebhook(req.user!._id, req.params.id);
      if (!channel) return reply.redirect("/settings", 303);
      return webhookPage(req, reply, channel, channel.url);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/settings/channels/:id/webhook",
    { preHandler: requireUser },
    async (req, reply) => {
      const channel = await findWebhook(req.user!._id, req.params.id);
      if (!channel) return reply.redirect("/settings", 303);
      const rawUrl = formField(req.body, "url");
      const fail = (error: string) => {
        reply.code(400);
        return webhookPage(req, reply, channel, rawUrl, error);
      };
      const checked = await checkUrl(rawUrl);
      if ("error" in checked) return fail(checked.error);
      const typed = validSecret(formField(req.body, "secret"));
      if (typed === false) return fail(SECRET_TOO_LONG);
      const secret =
        typed ?? (formField(req.body, "removeSecret") ? null : channel.secret);
      await alertChannels(db).updateOne(
        { _id: channel._id, ownerId: channel.ownerId, kind: "webhook" },
        { $set: { url: checked.url, secret } },
      );
      setFlash(reply, `${channel.name} saved.`);
      return reply.redirect("/settings", 303);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/settings/channels/:id/rename",
    { preHandler: requireUser },
    async (req, reply) => {
      const name = validChannelName(
        (req.body as Record<string, unknown> | undefined)?.name,
      );
      if (!name) {
        reply.code(400);
        return settingsPage(req, reply, {
          channelError: `A name needs 1 to ${MAX_CHANNEL_NAME_LENGTH} characters.`,
        });
      }
      const channel = await renameAlertChannel(
        db,
        req.user!._id,
        req.params.id,
        name,
      );
      if (channel) setFlash(reply, `Renamed to ${channel.name}.`);
      return reply.redirect("/settings", 303);
    },
  );

  app.get<{ Params: { id: string } }>(
    "/settings/channels/:id/delete",
    { preHandler: requireUser },
    async (req, reply) => {
      const channel = await findAlertChannel(db, req.user!._id, req.params.id);
      if (!channel) return reply.redirect("/settings", 303);
      return sendConfirmPage(reply, auth.csrfToken(req, reply), {
        title: "Remove Alert channel",
        question: `Remove ${channel.name}?`,
        explanation: html`Alerts stop arriving here. A Telegram chat can be
        linked again later with a new Link code.`,
        action: `/settings/channels/${String(channel._id)}/delete`,
        button: "Remove channel",
        cancel: "/settings",
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/settings/channels/:id/delete",
    { preHandler: requireUser },
    async (req, reply) => {
      const channel = await removeAlertChannel(
        db,
        req.user!._id,
        req.params.id,
      );
      if (channel) setFlash(reply, `${channel.name} removed.`);
      return reply.redirect("/settings", 303);
    },
  );

  app.post<{ Params: { id: string } }>(
    "/settings/channels/:id/test",
    { preHandler: requireUser },
    async (req, reply) => {
      const user = req.user!;
      const channel = await findAlertChannel(db, user._id, req.params.id);
      if (!channel) {
        return reply.errorPage(404);
      }
      if (!testAlertsPerUser.tryAcquire(String(user._id))) {
        reply.code(429);
        return settingsPage(req, reply, {
          channelError: "Too many test Alerts. Try again in a minute.",
        });
      }
      const result = await testAlertChannel(
        db,
        senders,
        channel,
        clock.now(),
        publicBaseUrl,
      );
      setFlash(
        reply,
        result.ok
          ? `Test Alert sent to ${channel.name}.`
          : `Test Alert to ${channel.name} failed: ${result.error}`,
      );
      return reply.redirect("/settings", 303);
    },
  );
}

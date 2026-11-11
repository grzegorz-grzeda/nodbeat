import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ObjectId, type Db } from "mongodb";
import {
  addAlertChannel,
  alertChannels,
  AlertChannelLimitError,
  CHANNEL_KIND_LABELS,
  findAlertChannel,
  MAX_CHANNEL_NAME_LENGTH,
  validChannelName,
  type AlertChannelDoc,
  type AlertChannelOf,
} from "./alert-channels.js";
import { requireUser, type Auth } from "./auth.js";
import type { Clock } from "./clock.js";
import { setFlash } from "./flash.js";
import { csrfField, html, type SafeHtml } from "./html.js";
import type { KeyedLock } from "./keyed-lock.js";
import { limitsFor } from "./limits.js";
import {
  checkOutboundUrl,
  MAX_OUTBOUND_URL_LENGTH,
  OutboundUrlError,
  type HostResolver,
} from "./outbound-http.js";

/** Longest Webhook secret or ntfy token, in characters. */
const MAX_SECRET_LENGTH = 200;

/** Alert channels that are an HTTP URL plus an optional credential (a Webhook's secret, an ntfy topic's token). */
type HttpChannelKind = "webhook" | "ntfy";
type HttpChannelDoc = AlertChannelOf<HttpChannelKind>;

/** A refused add form of an HTTP channel kind, shown again with the error. */
export interface RefusedHttpForm {
  kind: HttpChannelKind;
  error: string;
  name: string;
  url: string;
}

/** How Settings adds and edits each HTTP Alert channel kind. The credential is never shown again after saving. */
const HTTP_CHANNEL_FORMS: Record<
  HttpChannelKind,
  {
    /** Adding POSTs to `/settings/<addPath>`, editing to `/settings/channels/:id/<editPath>`. */
    addPath: string;
    editPath: string;
    /** The credential's field in the channel and in the forms. */
    credential: "secret" | "token";
    /** Above the add form. */
    intro: SafeHtml;
    /** On the edit page when there's no credential. */
    noCredential: string;
    credentialError: string;
    /** Characters a credential may have, beyond its length. */
    credentialPattern?: RegExp;
    /** Why the URL can't be one of this kind, or null. */
    urlError?: (url: URL) => string | null;
    /** The name of a channel added without one. */
    defaultName: (url: URL) => string;
  }
> = {
  webhook: {
    addPath: "webhooks",
    editPath: "webhook",
    credential: "secret",
    intro: html`Alerts are POSTed to the URL as JSON. With a secret, each
      request is signed in the <code>X-Nodbeat-Signature</code> header; see the
      <a href="/docs">API docs</a>.`,
    noCredential: "No secret: requests aren't signed.",
    credentialError: `A secret can have at most ${MAX_SECRET_LENGTH} characters.`,
    defaultName: (url) => url.hostname,
  },
  ntfy: {
    addPath: "ntfy",
    editPath: "ntfy",
    credential: "token",
    intro: html`Alerts are pushed to the topic on ntfy.sh or your own ntfy
    server: Down Alerts at high priority, Up Alerts at low priority. Give the
    full topic URL, and an access token if the topic needs one.`,
    noCredential: "No token: the topic must let anyone publish.",
    credentialError: `A token is 1 to ${MAX_SECRET_LENGTH} characters, without spaces.`,
    // Sent in a header.
    credentialPattern: /^[\x21-\x7e]+$/,
    urlError: (url) =>
      url.pathname.split("/").some((part) => part !== "")
        ? null
        : "Give the full topic URL, e.g. https://ntfy.sh/your-topic.",
    // Called after its topic.
    defaultName: (url) => {
      const topic = url.pathname.split("/").filter(Boolean).at(-1) ?? "";
      try {
        return decodeURIComponent(topic) || url.hostname;
      } catch {
        return topic;
      }
    },
  },
};

const HTTP_CHANNEL_KINDS = Object.keys(HTTP_CHANNEL_FORMS) as HttpChannelKind[];

const credentialOf = (channel: HttpChannelDoc): string | null =>
  channel.kind === "webhook" ? channel.secret : channel.token;

const isHttpChannel = (channel: AlertChannelDoc): channel is HttpChannelDoc =>
  (HTTP_CHANNEL_KINDS as string[]).includes(channel.kind);

const capitalized = (word: string) =>
  word.charAt(0).toUpperCase() + word.slice(1);

/** A form field as a string; "" when missing. */
const formField = (body: unknown, name: string): string => {
  const value = (body as Record<string, unknown> | undefined)?.[name];
  return typeof value === "string" ? value : "";
};

/** An HTTP channel's URL, whether it has a credential, and its Edit link, for its row in Settings; "" for other kinds. */
export function httpChannelSummary(channel: AlertChannelDoc): SafeHtml | "" {
  if (!isHttpChannel(channel)) return "";
  const { credential, editPath } = HTTP_CHANNEL_FORMS[channel.kind];
  return html`<small class="channel-url"
      ><code>${channel.url}</code>,
      ${credentialOf(channel) ? `${credential} set` : `no ${credential}`}</small
    >
    <a
      href="/settings/channels/${String(channel._id)}/${editPath}"
      class="button secondary"
      >Edit</a
    >`;
}

/** The add form of every HTTP channel kind; `refused` refills the one it came from. */
export const addHttpChannelForms = (
  csrf: string,
  refused?: RefusedHttpForm,
): SafeHtml[] =>
  HTTP_CHANNEL_KINDS.map((kind) => {
    const { addPath, credential, intro } = HTTP_CHANNEL_FORMS[kind];
    const label = CHANNEL_KIND_LABELS[kind];
    const own = refused?.kind === kind ? refused : undefined;
    return html`<h2>Add ${kind === "ntfy" ? "an" : "a"} ${label}</h2>
      <p>${intro}</p>
      ${own ? html`<p class="error">${own.error}</p>` : ""}
      <form method="post" action="/settings/${addPath}">
        ${csrfField(csrf)}
        <label
          >Name (optional)
          <input
            type="text"
            name="name"
            value="${own?.name ?? ""}"
            maxlength="${String(MAX_CHANNEL_NAME_LENGTH)}"
        /></label>
        <label
          >URL
          <input
            type="url"
            name="url"
            value="${own?.url ?? ""}"
            maxlength="${String(MAX_OUTBOUND_URL_LENGTH)}"
            placeholder="https://"
            required
        /></label>
        <label
          >${capitalized(credential)} (optional)
          <input
            type="password"
            name="${credential}"
            autocomplete="off"
            maxlength="${String(MAX_SECRET_LENGTH)}"
        /></label>
        <button type="submit">Add ${label}</button>
      </form>`;
  });

/** The origin a URL's credential is bound to: scheme, host and port. */
const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * Add and edit routes of the HTTP Alert channel kinds. A refused add form is shown on the Settings page, which
 * `settingsPage` renders.
 */
export function registerHttpChannelSettings(
  app: FastifyInstance,
  deps: {
    db: Db;
    clock: Clock;
    auth: Auth;
    /** Guards the per-User Alert channel limit, shared with linking a Telegram chat. */
    channelLock: KeyedLock;
    resolveHost: HostResolver;
    settingsPage: (
      req: FastifyRequest,
      reply: FastifyReply,
      options: { httpForm: RefusedHttpForm },
    ) => Promise<unknown>;
  },
): void {
  const { db, clock, auth, channelLock, resolveHost, settingsPage } = deps;

  /** The URL once safe to send to and fit for the kind, or the reason it isn't. */
  const checkUrl = async (
    kind: HttpChannelKind,
    value: string,
  ): Promise<{ url: URL } | { error: string }> => {
    let url: URL;
    try {
      url = await checkOutboundUrl(value.trim(), resolveHost);
    } catch (err) {
      if (err instanceof OutboundUrlError) return { error: err.message };
      throw err;
    }
    const error = HTTP_CHANNEL_FORMS[kind].urlError?.(url);
    return error ? { error } : { url };
  };

  /** null for none, false when not allowed. */
  const validCredential = (
    kind: HttpChannelKind,
    value: string,
  ): string | null | false => {
    if (value.length === 0) return null;
    const { credentialPattern } = HTTP_CHANNEL_FORMS[kind];
    return (
      value.length <= MAX_SECRET_LENGTH &&
      (credentialPattern?.test(value) ?? true) &&
      value
    );
  };

  const registerKind = (kind: HttpChannelKind) => {
    const form = HTTP_CHANNEL_FORMS[kind];
    const { credential } = form;
    const label = CHANNEL_KIND_LABELS[kind];

    app.post(
      `/settings/${form.addPath}`,
      { preHandler: requireUser },
      async (req, reply) => {
        const user = req.user!;
        const rawName = formField(req.body, "name");
        const rawUrl = formField(req.body, "url");
        const fail = (error: string) => {
          reply.code(400);
          return settingsPage(req, reply, {
            httpForm: { kind, error, name: rawName, url: rawUrl },
          });
        };
        const checked = await checkUrl(kind, rawUrl);
        if ("error" in checked) return fail(checked.error);
        const name =
          rawName.trim() === ""
            ? (validChannelName(form.defaultName(checked.url)) ??
              checked.url.hostname)
            : validChannelName(rawName);
        if (!name) {
          return fail(
            `A name needs 1 to ${MAX_CHANNEL_NAME_LENGTH} characters.`,
          );
        }
        const value = validCredential(kind, formField(req.body, credential));
        if (value === false) return fail(form.credentialError);
        const base = {
          _id: new ObjectId(),
          ownerId: user._id,
          name,
          url: checked.url.href,
          createdAt: clock.now(),
          failingSince: null,
          lastError: null,
        };
        const channel: HttpChannelDoc =
          kind === "webhook"
            ? { ...base, kind, secret: value }
            : { ...base, kind, token: value };
        try {
          await addAlertChannel(db, channelLock, channel, {
            limit: limitsFor(user).maxAlertChannels,
          });
        } catch (err) {
          if (!(err instanceof AlertChannelLimitError)) throw err;
          return fail(`${err.message} Remove one first.`);
        }
        setFlash(reply, `${label} ${name} added.`);
        return reply.redirect("/settings", 303);
      },
    );

    const find = async (ownerId: ObjectId, id: string) => {
      const channel = await findAlertChannel(db, ownerId, id);
      return channel && channel.kind === kind
        ? (channel as HttpChannelDoc)
        : null;
    };

    /** Edits the channel's URL and credential; the credential itself is never shown. */
    const editPage = (
      req: FastifyRequest,
      reply: FastifyReply,
      channel: HttpChannelDoc,
      url: string,
      error?: string,
    ) => {
      const has = credentialOf(channel) !== null;
      return reply.page({
        title: `Edit ${channel.name}`,
        body: html`<h1>Edit ${label} ${channel.name}</h1>
          ${error ? html`<p class="error">${error}</p>` : ""}
          <form
            method="post"
            action="/settings/channels/${String(channel._id)}/${form.editPath}"
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
              >${capitalized(credential)}
              <input
                type="password"
                name="${credential}"
                autocomplete="off"
                maxlength="${String(MAX_SECRET_LENGTH)}"
                placeholder="${has ? `${credential} set` : `no ${credential}`}"
            /></label>
            <p>
              ${
                has
                  ? `${capitalized(credential)} set. Leave empty to keep it, or type a new one. Moving the URL to another host removes it unless you type one.`
                  : form.noCredential
              }
            </p>
            ${
              has
                ? html`<label
                    ><input
                      type="checkbox"
                      name="remove${capitalized(credential)}"
                      value="1"
                    />
                    Remove the ${credential}</label
                  >`
                : ""
            }
            <button type="submit">Save ${label}</button>
            <a href="/settings" class="button secondary">Cancel</a>
          </form>`,
      });
    };

    app.get<{ Params: { id: string } }>(
      `/settings/channels/:id/${form.editPath}`,
      { preHandler: requireUser },
      async (req, reply) => {
        const channel = await find(req.user!._id, req.params.id);
        if (!channel) return reply.redirect("/settings", 303);
        return editPage(req, reply, channel, channel.url);
      },
    );

    app.post<{ Params: { id: string } }>(
      `/settings/channels/:id/${form.editPath}`,
      { preHandler: requireUser },
      async (req, reply) => {
        const channel = await find(req.user!._id, req.params.id);
        if (!channel) return reply.redirect("/settings", 303);
        const rawUrl = formField(req.body, "url");
        const fail = (error: string) => {
          reply.code(400);
          return editPage(req, reply, channel, rawUrl, error);
        };
        const checked = await checkUrl(kind, rawUrl);
        if ("error" in checked) return fail(checked.error);
        const typed = validCredential(kind, formField(req.body, credential));
        if (typed === false) return fail(form.credentialError);
        const removed = formField(req.body, `remove${capitalized(credential)}`);
        const stored = credentialOf(channel);
        // A credential is for the host it was given for: it never follows the URL elsewhere.
        const moved =
          typed === null &&
          !removed &&
          stored !== null &&
          originOf(channel.url) !== checked.url.origin;
        const value = typed ?? (removed || moved ? null : stored);
        await alertChannels(db).updateOne(
          { _id: channel._id, ownerId: channel.ownerId, kind },
          { $set: { url: checked.url.href, [credential]: value } },
        );
        setFlash(
          reply,
          moved
            ? `${channel.name} saved. Its ${credential} was removed: the URL points at another host.`
            : `${channel.name} saved.`,
        );
        return reply.redirect("/settings", 303);
      },
    );
  };
  HTTP_CHANNEL_KINDS.forEach(registerKind);
}

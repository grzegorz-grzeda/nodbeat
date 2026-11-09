import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import { html } from "./html.js";

interface ErrorText {
  title: string;
  message: string;
}

const TEXTS: Record<number, ErrorText> = {
  400: {
    title: "Bad request",
    message: "Something in that request wasn't right. Go back and try again.",
  },
  403: {
    title: "Forbidden",
    message: "You can't do that here.",
  },
  404: {
    title: "Page not found",
    message: "There's nothing at this address.",
  },
  413: {
    title: "Too large",
    message: "That request was too large.",
  },
  415: {
    title: "Unsupported format",
    message: "nodbeat can't read that kind of request.",
  },
  429: {
    title: "Too many requests",
    message: "Slow down a little and try again in a moment.",
  },
  500: {
    title: "Something went wrong",
    message: "nodbeat hit an unexpected error. Try again in a moment.",
  },
};

function textFor(status: number): ErrorText {
  return TEXTS[status] ?? TEXTS[status >= 500 ? 500 : 400]!;
}

export interface ErrorPageOptions {
  /** Replaces the heading for this status, e.g. "Expired form". */
  title?: string;
  /** Replaces the explanation for this status, e.g. "No such Monitor.". */
  message?: string;
}

declare module "fastify" {
  interface FastifyReply {
    /**
     * Sends the error answer every route shares: the app-shell error page for browsers, `{ error }` for a request
     * that asks for JSON, and plain text on Heartbeat URLs (devices read the body).
     */
    errorPage(status: number, options?: ErrorPageOptions): FastifyReply;
  }
}

const wantsJson = (req: FastifyRequest) => {
  const accept = req.headers.accept ?? "";
  return accept.includes("application/json") && !accept.includes("text/html");
};

const isHeartbeatUrl = (req: FastifyRequest) => req.url.startsWith("/hb/");

/** Adds `reply.errorPage()` and routes unknown URLs and uncaught errors through it. Needs `reply.page()`. */
export function registerErrorPages(app: FastifyInstance): void {
  app.decorateReply(
    "errorPage",
    function (this: FastifyReply, status: number, options = {}) {
      const req = this.request;
      const text = textFor(status);
      const title = options.title ?? text.title;
      const message = options.message ?? text.message;
      this.code(status);
      if (isHeartbeatUrl(req)) {
        // Same bodies the Heartbeat URL has always answered with ("Not Found", "Too Many Requests", ...).
        return this.type("text/plain").send(plainStatus(status));
      }
      if (wantsJson(req)) return this.send({ error: message });
      const back = req.user
        ? html`<a href="/">Back to the Dashboard</a>`
        : html`<a href="/">Go to the home page</a>`;
      return this.page({
        title,
        body: html`<div class="card narrow">
          <p class="muted">Error ${status}</p>
          <h1>${title}</h1>
          <p class="error">${message}</p>
          <p>${back}</p>
        </div>`,
      });
    },
  );

  app.setNotFoundHandler(async (_req, reply) => reply.errorPage(404));

  app.setErrorHandler<FastifyError>(async (error, req, reply) => {
    const status =
      error.statusCode && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 500;
    if (status >= 500) req.log.error({ err: error }, "request failed");
    return reply.errorPage(status);
  });
}

function plainStatus(status: number): string {
  const names: Record<number, string> = {
    400: "Bad Request",
    404: "Not Found",
    413: "Payload Too Large",
    429: "Too Many Requests",
  };
  return names[status] ?? (status >= 500 ? "Internal Server Error" : "Error");
}

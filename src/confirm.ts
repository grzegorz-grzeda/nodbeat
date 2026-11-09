import type { FastifyReply } from "fastify";
import { csrfField, html, type SafeHtml } from "./html.js";

export interface ConfirmOptions {
  /** Page title. */
  title: string;
  /** The heading, e.g. "Delete Garden sensor?". */
  question: string;
  /** What happens when confirmed. */
  explanation: SafeHtml;
  /** Where the confirming form posts. */
  action: string;
  /** Label of the confirming (danger) button. */
  button: string;
  /** Where Cancel goes back to. */
  cancel: string;
}

/** Sends an "Are you sure?" page for a destructive action; works without JS (CSP allows no inline confirm()). */
export function sendConfirmPage(
  reply: FastifyReply,
  csrf: string,
  options: ConfirmOptions,
): FastifyReply {
  return reply.page({ title: options.title, body: confirmBody(options, csrf) });
}

function confirmBody(options: ConfirmOptions, csrf: string): SafeHtml {
  return html`<div class="card narrow">
    <h1>${options.question}</h1>
    <p>${options.explanation}</p>
    <form class="actions" method="post" action="${options.action}">
      ${csrfField(csrf)}
      <button type="submit" class="danger">${options.button}</button>
      <a href="${options.cancel}">Cancel</a>
    </form>
  </div>`;
}

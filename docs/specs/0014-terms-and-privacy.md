# Spec 0014: Terms and Privacy

Status: ready-for-agent

Blocked by: none

## Problem Statement

Before charging money or letting strangers in, nodbeat needs Terms of Service and a Privacy policy that Users have agreed to. Today there are none, and nothing records who accepted what.

## Solution

Two public pages, `/terms` and `/privacy`, whose text the Operator writes as Markdown files kept on their own server, outside the repo, so a self-hosted instance never shows G2Labs' Terms or details. New Users accept both (a checkbox) when they accept an Invite or sign up. When a document's version changes, existing Users are asked to accept the new one on their next page load. Each acceptance is recorded.

## User Stories

1. As a visitor, I want `/terms` and `/privacy` linked from the footer of every page, so that I can read them before signing up.
2. As a new User, I want a required "I accept the Terms and Privacy policy" checkbox before my account is created, so that the agreement is explicit.
3. As a User, I want to be asked to accept a changed version once, with a short "what changed" line, so that I'm not surprised.
4. As the Admin, I want each User's accepted versions and times recorded, so that I can show who agreed to what.
5. As a buyer, I want the Terms and the footer to name the Operator (name, NIP, address, contact email), so that I know who I'm dealing with.
6. As a business User, I want the Terms to include processor terms (GDPR Art. 28) for what I put into nodbeat, so that I don't need a separate DPA.
7. As a consumer buying Pro, I want the Terms to promise a full refund on request within 14 days of buying, so that I can change my mind.
8. As a reader of the Privacy policy, I want it to list the subprocessors (MongoDB Atlas, Stripe, Google, GitHub, Telegram, the hosting provider), where data is stored, and how long logs are kept per Plan, that Heartbeats keep the sender's IP and User-Agent for as long as the Plan keeps Heartbeats, and that request logs are kept 14 days, so that I know where my data goes.

## Implementation Decisions

- **Location**: `LEGAL_DIR` env var points at a directory on the host (mounted into the container); not in the repo or the Docker image (ADR 0008). It holds `terms.md`, `privacy.md` and `operator.md`.
- **Content**: `terms.md`, `privacy.md`, each with a front-matter `version` (date, e.g. `2026-12-01`) and `summary`. Rendered server-side to HTML at startup with a small Markdown renderer (headings, paragraphs, lists, links only). The text itself is the Operator's job, not this spec's; the spec's tests use fixture files. `operator.md` holds the Operator's name, NIP, address and contact email, shown in the footer and at the top of `/terms`.
- **Required content checklist** (for the Operator, in `docs/runbook.md`, spec 0019): Terms per UŚUDE art. 8, Art. 28 processor terms for business Users, the 14-day consumer refund, the DSA contact point and how to report illegal content; Privacy policy with controller, legal bases, subprocessors (MongoDB Atlas Frankfurt, VPS host, Stripe, Google, GitHub, Telegram), retention per Plan, Heartbeat IP/User-Agent, 14-day request logs, data subject rights (export, spec 0018; deletion, spec 0012) and UODO as the supervisory authority.
- **Self-hosted**: if `LEGAL_DIR` is unset or the files are missing, the pages and the checkbox don't exist.
- **Storage**: `users.accepted: { terms: { version, at }, privacy: { version, at } }`.
- **Re-acceptance**: a hook after `requireUser` redirects HTML pages (not the Heartbeat URL, API or Telegram webhook) to `/accept-terms` when a stored version is older than the current one. Heartbeats and Alerts are never blocked by it.
- **Existing Users** get the prompt on their first login after this ships.

## Testing Decisions

- Single seam as usual. Scenarios: pages render and are in the footer; Invite accept without the checkbox → error; with it → versions recorded; bump the version → next page load redirects to `/accept-terms`, Heartbeats still `200`; accept → back to the page; `LEGAL_DIR` unset or files missing → `/terms` `404`, no checkbox, no Operator in the footer; Operator details shown in the footer and on `/terms`.

## Out of Scope

- Writing the legal text (the Operator's job, with a lawyer).
- Cookie banner (nodbeat sets only essential cookies).
- A separately signed DPA: the Terms carry the processor terms (ADR 0008).

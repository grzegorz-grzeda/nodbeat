# Spec 0014: Terms and Privacy

Status: needs-triage

Blocked by: none

## Problem Statement

Before charging money or letting strangers in, nodbeat needs Terms of Service and a Privacy policy that Users have agreed to. Today there are none, and nothing records who accepted what.

## Solution

Two public pages, `/terms` and `/privacy`, whose text the owner writes as Markdown files in the repo. New Users accept both (a checkbox) when they accept an Invite or sign up. When a document's version changes, existing Users are asked to accept the new one on their next page load. Each acceptance is recorded.

## User Stories

1. As a visitor, I want `/terms` and `/privacy` linked from the footer of every page, so that I can read them before signing up.
2. As a new User, I want a required "I accept the Terms and Privacy policy" checkbox before my account is created, so that the agreement is explicit.
3. As a User, I want to be asked to accept a changed version once, with a short "what changed" line, so that I'm not surprised.
4. As the Admin, I want each User's accepted versions and times recorded, so that I can show who agreed to what.
5. As a reader of the Privacy policy, I want it to list the subprocessors (MongoDB Atlas, Stripe, Google, GitHub, Telegram, the hosting provider), where data is stored, and how long logs are kept per Plan, so that I know where my data goes.

## Implementation Decisions

- **Content**: `legal/terms.md`, `legal/privacy.md`, each with a front-matter `version` (date, e.g. `2026-12-01`) and `summary`. Rendered server-side to HTML at startup with a small Markdown renderer (headings, paragraphs, lists, links only). The text itself is the owner's job, not this spec's.
- **Self-hosted**: if the files are missing, the pages and the checkbox don't exist.
- **Storage**: `users.accepted: { terms: { version, at }, privacy: { version, at } }`.
- **Re-acceptance**: a hook after `requireUser` redirects HTML pages (not the Heartbeat URL, API or Telegram webhook) to `/accept-terms` when a stored version is older than the current one. Heartbeats and Alerts are never blocked by it.
- **Existing Users** get the prompt on their first login after this ships.

## Testing Decisions

- Single seam as usual. Scenarios: pages render and are in the footer; Invite accept without the checkbox → error; with it → versions recorded; bump the version → next page load redirects to `/accept-terms`, Heartbeats still `200`; accept → back to the page; files missing → `/terms` `404`, no checkbox.

## Out of Scope

- Writing the legal text.
- Cookie banner (nodbeat sets only essential cookies).
- A DPA download for business customers.

# Spec 0020: Landing page and Invite requests

Status: resolved

Blocked by: none

## Problem Statement

The landing page shows a hero, three steps and a list of features from v1: no Schedules, Start and Fail signals, Webhooks or ntfy. A visitor can't see what nodbeat looks like before having an account, and someone who wants to try it has no way to ask: nodbeat is invite-only (until spec 0017), and the page just says so.

## Solution

Extend the landing page with a preview of the app (the Dashboard, a Monitor's Incidents, a Telegram Alert), drawn in HTML with the app's own styles and demo data rather than as images, usage examples for common clients, and a current list of features. Add a "Request an Invite" form: a visitor leaves an email and an optional note, and the Admin sees the request on the Invites page and can turn it into an Invite or dismiss it. The form is opt-in per instance (`INVITE_REQUESTS=true`), so self-hosters don't collect strangers' emails without meaning to.

## User Stories

1. As a visitor, I want to see what the Dashboard, a Monitor's history and an Alert look like, so that I know what I'd get.
2. As a visitor, I want copy-paste examples for cron, systemd, a shell script with Start and Fail signals, and a microcontroller, so that I can tell it fits my setup.
3. As a visitor, I want to request an Invite with my email and a short note, so that I can try nodbeat.
4. As a visitor, I want to be told what my email is used for and how long it's kept, so that I can trust the form.
5. As the Admin, I want pending Invite requests listed on the Invites page, with a button to create an Invite for one and another to dismiss it, so that handling them takes one click.
6. As the Admin, I want the created Invite's link offered as an email to the requester, so that I don't have to copy addresses.
7. As the Operator, I want requests limited per IP and in total, so that the form can't be used to fill the database.
8. As a self-hoster, I want the form off unless I turn it on, so that my instance doesn't collect emails I didn't ask for.

## Implementation Decisions

- **Config**: `INVITE_REQUESTS=true` turns the form on; anything else leaves it off and the landing page says nodbeat is invite-only, as before.
- **Mockups**: static HTML in `landing.ts` with demo data, reusing the Dashboard's table, state badges and cards, so they follow the theme and the real styles. Marked `aria-hidden` with a text alternative, and not interactive.
- **Route**: `POST /invite-requests` (CSRF), fields `email` (required, valid, at most 254 characters), `note` (optional, at most 500 characters) and a hidden honeypot `website`. Success is a 303 to `/` with a Flash message. The same message is shown whether the email is new, already requested, already a User or the honeypot was filled, so the form doesn't tell who has an account.
- **Storage**: `inviteRequests { _id, email (normalized, unique), note, createdAt, expiresAt }`. A repeat request for the same email updates the note and keeps the original time. No IP is stored.
- **Retention**: a request is deleted when the Admin creates its Invite or dismisses it, and otherwise expires after 30 days (TTL index on `expiresAt`; lists filter on it too).
- **Limits**: 3 requests per IP per hour (`SlidingWindowLimiter`) → `429`; at most 200 pending requests → `503` "not taking requests right now".
- **Admin**: an "Invite requests" table on `/admin/invites` (email, note, requested), with "Create Invite" (`POST /admin/invite-requests/:id/invite`: an Invite noted with the email, the request deleted, the usual "Invite created" page plus a `mailto:` link prefilled with the link) and "Dismiss" (`POST /admin/invite-requests/:id/dismiss`). The `/admin` link to Invites shows the pending count.
- **Privacy**: the form says the email is used only to send an Invite and is deleted once handled or after 30 days, and links the Privacy policy when there is one. The Operator's `privacy.md` has to cover it (see `docs/deploy.md`).
- **Spec 0017**: when sign-up opens, the form gives way to sign-up.

## Testing Decisions

- Single seam as usual (`buildTestApp`, `Browser`). Scenarios:
  - The form only shows, and the route only exists, with `inviteRequests` on.
  - A valid request shows on the Admin's Invites page.
  - A repeat request keeps one row.
  - Existing User emails, the honeypot and invalid emails: the first two are not stored; invalid emails → `400`.
  - The IP limit → `429`; the total cap → `503`.
  - Create Invite gives a working Invite link and a `mailto:`, and removes the request.
  - Dismiss removes the request.
  - After 30 days a request no longer shows.
  - Non-Admins get `403` on the Admin routes; a request without CSRF is refused.
- Landing: the mockups, usage examples (with the instance's Heartbeat URL) and the new features are shown, and there's still no sign-up.

## Out of Scope

- Telling the Admin about new requests (Telegram, email).
- Sending emails from nodbeat.
- Real screenshots or a live demo account.

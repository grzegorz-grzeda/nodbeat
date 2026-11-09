# Spec 0008: Invite links

Status: needs-triage

Blocked by: spec 0006 (Admin guard and Admin page)

## Problem Statement

I want a handful of hobbyists to try nodbeat so I learn what they need, but the only way to create a User is the CLI on the VPS, where I also have to choose their password. I don't want public registration yet: the instance runs on a free Atlas tier and Plans don't exist.

## Solution

The Admin creates an **Invite** from the Admin page and sends its link by any channel. Whoever opens the link chooses their email, password and time zone, gets a User, and is logged in. An Invite works once and expires after 7 days. The Admin sees every Invite and can revoke one that hasn't been used.

## User Stories

1. As the Admin, I want to create an Invite with an optional note ("for Marek"), so that I remember who it was for.
2. As the Admin, I want the Invite link shown once right after creating it, with a copy button, so that I can paste it into a message.
3. As the Admin, I want Invite links to be unguessable, single-use and to expire after 7 days, so that a forwarded or leaked link does little harm.
4. As the Admin, I want a list of Invites showing note, created, expires, and either pending, expired, revoked or used by which email and when, so that I know who joined.
5. As the Admin, I want to revoke a pending Invite, so that a link sent to the wrong person stops working.
6. As an invited person, I want to open the link and choose my email, password and time zone, so that I get an account without the Admin knowing my password.
7. As an invited person, I want to be logged in and on the Dashboard right after accepting, so that I can create my first Monitor straight away.
8. As an invited person, I want a used, expired, revoked or unknown link to show a clear "this Invite can't be used" page, so that I know to ask for a new one.
9. As the Admin, I want an invited User never to be an Admin, so that an Invite can't give away the instance.
10. As the Admin, I want the accept form rate-limited per IP, so that Invite links can't be guessed.
11. As a visitor without an Invite, I want the landing page to say nodbeat is invite-only, so that I don't look for a sign-up button.

## Implementation Decisions

- **Collection `invites`**: `_id` = sha256 of the code (like sessions, so a database leak doesn't leak live links), `note`, `createdBy`, `createdAt`, `expiresAt`, `revokedAt`, `usedAt`, `usedBy`. Kept after use as the Invite history; no TTL index.
- **Code**: 32 random bytes, base64url. Link: `PUBLIC_BASE_URL/invite/<code>`. Only shown on the page right after creating; it can't be shown again, since only its hash is stored.
- **Admin routes** (behind spec 0006's `requireAdmin`): `GET /admin/invites` (list + create form), `POST /admin/invites` (create, then the one-time link page), `GET|POST /admin/invites/:id/revoke` (confirmation page, then revoke), reusing `sendConfirmPage` and Flash messages. The Admin page links to the list.
- **Accept routes** (public): `GET /invite/:code` shows the form or the "can't be used" page; `POST /invite/:code` creates the User. Both CSRF-protected like the login form.
- **Accepting** is one atomic `findOneAndUpdate` that sets `usedAt` only on a pending, unexpired, unrevoked Invite, so two parallel submissions can't create two Users. If creating the User then fails (email taken, password too short, unknown time zone), the Invite is released again and the form is shown with the error.
- **User creation** goes through `createUser` in `src/users.ts` with `isAdmin: false`, so email, password and time-zone rules are the same as the CLI's. Then a session is started like a login.
- **Rate limit**: `POST /invite/:code` and `GET /invite/:code` share a per-IP sliding window (10 per 15 min), reusing `SlidingWindowLimiter`.
- **Landing page**: the "Log in" button stays; a line says "nodbeat is invite-only for now". Still no sign-up link.
- **Limits**: invited Users get the same `limitsFor` as everyone.

## Glossary Additions

Add to `GLOSSARY.md` when this ships:

- **Invite**: a single-use link from the Admin that lets one person create a User. _Avoid_: Registration, sign-up code, token.

## Testing Decisions

- Same single seam: `createApp`, Fastify `inject`, the fake clock, real Mongo in memory.
- Scenarios: Admin creates an Invite → link → accept with email/password/time zone → logged in on the Dashboard, can create a Monitor, isn't Admin (`/admin` → 404); the same link again → "can't be used"; advance 7 days → expired; revoked → "can't be used"; email already taken → form error and the Invite still works; two parallel accepts → one User; a non-Admin can't reach `/admin/invites`; 11th attempt from one IP → `429`; the Invite list shows "used by <email>".
- The CLI `create-user` keeps working unchanged.

## Out of Scope

- Public registration, Plans and billing.
- Sending Invites by email (nodbeat sends no email).
- Deleting or disabling Users from the web.
- Invites that grant Admin.

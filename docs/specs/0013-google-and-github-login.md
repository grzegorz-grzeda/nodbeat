# Spec 0013: Google and GitHub login

Status: ready-for-agent

Blocked by: none

## Problem Statement

I want to open nodbeat to strangers and sell Pro, but every User today has an email + password and nodbeat sends no email. Without email I can't verify addresses or reset passwords, and adding email sending is one more provider, one more deliverability problem and one more subprocessor. Google and GitHub already verify emails and handle forgotten passwords.

## Solution

A User can log in with Google or GitHub. Each of password, Google and GitHub is a **Login method**; a User has at least one. New Users (via Invite now, via open sign-up in spec 0017) are created with Google or GitHub only, never with a password. Existing Users keep their password and can connect Google/GitHub in Settings. A Google/GitHub account is never joined to an existing User just because the emails match. For existing password Users who forgot their password, the Admin can create a one-time reset link.

## User Stories

1. As a visitor, I want "Log in with Google" and "Log in with GitHub" buttons on the login page, so that I don't need another password.
2. As an invited person, I want to accept an Invite with Google or GitHub, so that my account has no password to forget.
3. As an invited person, I want my User's email taken from Google/GitHub (verified address only), so that it's real without nodbeat sending mail.
4. As an existing User, I want to connect Google or GitHub in Settings while logged in, so that I can log in with them from then on.
5. As an existing User, I want a Google/GitHub login whose email matches mine but isn't connected to refuse with "connect it in Settings first", so that nobody controlling a matching email elsewhere takes over my account.
6. As a User, I want to see my Login methods in Settings and remove any but the last, so that I can't lock myself out.
7. As a User with a Google/GitHub Login method, I want to add or remove a password, so that I choose how I log in.
8. As a User, I want "Log out everywhere" and password change to keep working as now, so that security controls don't regress.
9. As the Admin, I want to create a one-time password reset link for a User from the Admin page (valid 24 h, single use, revocable by creating a new one), so that a User who forgot their password isn't stuck.
10. As a User opening a reset link, I want to set a new password and have every other session logged out, so that whoever had my old password loses access.
11. As the Admin, I want the per-User table to show each User's Login methods, so that I know who still depends on a password.

## Implementation Decisions

- **Protocol**: OAuth 2.0 authorization code flow with PKCE and `state`, done by hand with `fetch` (no auth library), like the Telegram and ntfy clients. Google: OpenID Connect, take `sub` and `email` only if `email_verified`. GitHub: `/user` for `id`, `/user/emails` for the primary verified email.
- **Config**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, all optional; a provider without both is hidden. Self-hosted instances without any keep password-only behaviour (including password Invites).
- **Storage**: `users.logins: [{ kind: "google" | "github", subject: string, email: string, linkedAt: Date }]`, with a unique index on `(logins.kind, logins.subject)`. `passwordHash` becomes optional. The provider's `sub`/`id` is the key, never the email; the User's `email` is set once at creation and not overwritten on later logins.
- **Routes**: `GET /auth/:kind/start?intent=login|link|invite:<code>` (sets a short-lived signed cookie with state + PKCE verifier, redirects), `GET /auth/:kind/callback`. Callback errors land on the login page with a Flash message.
- **Matching**: login looks up by `(kind, subject)` only. No User → "No nodbeat account for this Google account" (until spec 0017). A matching email on another User is never auto-linked (story 5).
- **Invites**: the accept page offers Google/GitHub buttons when configured, and then no password form. The atomic accept from spec 0008 stays; it runs in the callback.
- **Reset links**: collection `password_resets` like `invites` (sha256 `_id`, `userId`, `expiresAt`, `usedAt`); one live link per User, a new one replaces the old. Routes `GET|POST /reset/:code` (public, rate-limited per IP like Invites), `POST /admin/users/:id/reset-link` (Admin).
- **Rate limits**: OAuth callbacks share the per-IP login limiter.
- **CSP**: unchanged; the flow is plain redirects, no provider scripts.

## Glossary Additions

- **Login method** (already added).

## Testing Decisions

- Single seam: `createApp`, Fastify `inject`, fake clock, in-memory Mongo, and a fake OAuth provider injected like the Telegram client (token + userinfo endpoints).
- Scenarios: Invite accepted via Google → User with one Login method, no password, logged in; log out and back in via Google; unverified Google email → refused; GitHub with no verified primary email → refused; existing password User logs in via Google with the same email → refused, then connects in Settings, then logs in via Google; removing the last Login method → refused; state mismatch / missing PKCE cookie → refused; Admin reset link → new password works, old sessions `401`, link reused → "can't be used", after 24 h → expired; no provider configured → no buttons, password Invites as before.

## Out of Scope

- Email sending, email verification, self-service password reset.
- Other providers (Apple, Microsoft, generic OIDC).
- Changing the User's email after creation.
- Open sign-up (spec 0017).

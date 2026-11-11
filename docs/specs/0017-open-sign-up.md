# Spec 0017: Open sign-up

Status: ready-for-agent

Blocked by: spec 0012 (Account deletion), spec 0013 (Google and GitHub login), spec 0014 (Terms and Privacy), spec 0015 (Plans and limits), spec 0016 (Stripe billing)

## Problem Statement

With Plans and billing working for invited Users, the only thing stopping growth is the Invite. Strangers should be able to start on Free in a minute, without making nodbeat an easy target for abuse or outgrowing the free Atlas tier unnoticed.

## Solution

Anyone can sign up with Google or GitHub (no password sign-up) and lands on Free. Invites stay for the Admin to hand out, but aren't needed. Sign-ups are limited per IP. The landing page gets a "Sign up free" button and a pricing section. Before this ships, the infrastructure is upgraded (see Implementation Decisions).

## User Stories

1. As a visitor, I want "Sign up with Google / GitHub" on the landing page, so that I can start without asking anyone.
2. As a visitor, I want a pricing section comparing Free and Pro, so that I know what I get.
3. As a new User, I want to accept the Terms and Privacy policy and pick my time zone (pre-filled from my browser) on one screen after Google/GitHub, so that sign-up is one step.
4. As a new User, I want to land on an empty Dashboard with a "Create your first Monitor" hint, so that I know what to do.
5. As a visitor whose Google/GitHub account already has a User, I want sign-up to just log me in, so that I don't hit an error.
6. As a visitor whose verified email matches an existing User but whose Google/GitHub account isn't connected, I want "an account with this email exists; log in and connect it in Settings", so that I'm not given a duplicate.
7. As the Admin, I want at most 5 sign-ups per IP per hour, so that one host can't mass-create Users.
8. As the Admin, I want a switch to close sign-up again (back to invite-only), so that I can react to abuse.
9. As the Admin, I want the Admin page to show sign-ups per day (open sign-ups and Invites counted apart), so that I see growth and spikes.

## Implementation Decisions

- **Flow**: `GET /auth/:kind/start?intent=signup` (spec 0013). In the callback, an unknown `(kind, subject)` with a verified email not used by any User creates a pending sign-up (signed short-lived cookie with kind, subject, email) and shows `/signup/finish` (time zone + Terms checkbox). `POST /signup/finish` creates the User on Free.
- **Switch**: `SIGNUP_OPEN=true|false` env var (default `false`), so closing sign-up is an edit + restart; no runtime toggle.
- **Rate limit**: `SlidingWindowLimiter`, 5 per IP per hour on `POST /signup/finish`, plus the login limiter on callbacks.
- **No password sign-up, no email verification**: Google/GitHub verified emails only.
- **Landing page**: the "invite-only for now" line goes; pricing taken from spec 0016's Stripe prices at startup.
- **Infrastructure prerequisites** (the Operator's checklist, not code; issue 0074): Atlas upgraded from M0 to a paid tier with backups; a public status page; capacity check against spec 0015's log sizes; OAuth apps, Stripe and env vars set up; the VPS host in the EU with a signed DPA; DPAs with every subprocessor and a record of processing activities (ADR 0008); edge Caddy logs kept at most 14 days; legal text reviewed by a lawyer.

## Testing Decisions

- Single seam with the fake OAuth provider. Scenarios: sign-up via GitHub → finish page → User on Free, Terms recorded, Dashboard; same GitHub account again → logged in; matching email of an existing password User → refused with the connect hint; 6th sign-up from one IP in an hour → `429`; `SIGNUP_OPEN=false` → no button, `intent=signup` refused, Invites still work; finish page without the checkbox → error.

## Out of Scope

- Password sign-up and email verification.
- CAPTCHA, disposable-email blocking (Google/GitHub accounts only).
- Teams.
- Referral or affiliate programs.

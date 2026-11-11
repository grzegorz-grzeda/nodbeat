# Spec 0019: Compliance basics

Status: needs-triage

Blocked by: none

## Problem Statement

Before charging money (spec 0016), nodbeat should look and act like a service people can trust: a way to report vulnerabilities, request logs that don't keep IPs for an unknown time, and a written plan for breaches, support and refunds. ADR 0008 decides which laws apply. This spec covers the small things that follow from it. None of them are features, and all of them are easy to forget.

## Solution

Publish `security.txt` and `SECURITY.md`. Make request logs on the server rotate by time and keep at most 14 days. Write an Operator runbook in `docs/` for breaches, support, refunds and the records GDPR expects the Operator to keep.

## User Stories

1. As a security researcher, I want `/.well-known/security.txt` and a `SECURITY.md` in the repo telling me where to report a vulnerability, so that I can report it privately.
2. As a User, I want request logs holding my IP kept at most 14 days, as the Privacy policy says, so that the promise is true.
3. As the Operator, I want a runbook for a data breach (what to check, who to tell, UODO within 72 h, telling Users), so that I don't improvise under stress.
4. As the Operator, I want a runbook for support (contact email, reply within 2 business days) and for consumer refunds within 14 days (done by hand in the Stripe Dashboard), so that I keep what the Terms promise.
5. As the Operator, I want a checklist of the records I must keep (record of processing activities, signed DPAs with each subprocessor), so that I can show them if asked.

## Implementation Decisions

- **security.txt**: served at `/.well-known/security.txt` (RFC 9116) with `Contact`, `Expires` (one year from build), `Preferred-Languages: en, pl` and `Policy` pointing at `SECURITY.md` on GitHub. The contact comes from `SECURITY_CONTACT` (a `mailto:` or https URL); unset → `404`, so self-hosters don't publish G2Labs' address.
- **SECURITY.md**: GitHub private vulnerability reporting as the route, supported version = latest release, a target of 7 days for a first answer.
- **Request logs**: the time limit is set in deploy config, not in the code. Docker's `json-file` driver only rotates by size, so `compose.yaml` switches to the `local` or `journald` driver with a 14-day limit, or keeps `json-file` and adds a daily logrotate. Pick whichever works on the VPS, and document it in `docs/deploy.md`. The edge Caddy needs the same limit, but that change is in the edge repo.
- **Runbook**: `docs/runbook.md`, written for the Operator. It covers:
  - breach steps;
  - support;
  - refunds;
  - the yearly `security.txt` renewal (comes with a release);
  - the records checklist;
  - the legal-text content checklist from spec 0014.

## Testing Decisions

- `security.txt`: served with `text/plain` when `SECURITY_CONTACT` is set, with a valid `Expires`, and `404` when unset.
- The rest is documentation and deploy config, checked by reading it.

## Out of Scope

- A bug bounty.
- Certifications (ISO 27001, SOC 2).
- Writing the legal text (spec 0014) or a lawyer's review.

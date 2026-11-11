# 0074: Infrastructure before open sign-up

Spec: 0017
Status: ready-for-human

**What to build:** The owner prepares the infrastructure before open sign-up ships. This is a checklist, not code.

**Blocked by:** None (can start immediately).

- [ ] Atlas upgraded from M0 to a paid tier with backups
- [ ] A public status page
- [ ] Capacity check against spec 0015's log sizes
- [ ] Google and GitHub OAuth apps created, Stripe products/prices and Tax set up, env vars set on the server
- [ ] VPS host is in the EU and its DPA is signed
- [ ] DPAs in place with MongoDB Atlas, Stripe, Google, GitHub and Telegram (their standard terms, saved)
- [ ] Record of processing activities written (checklist in `docs/runbook.md`)
- [ ] Edge Caddy access logs kept at most 14 days (edge repo)
- [ ] Legal text in `LEGAL_DIR` reviewed by a lawyer

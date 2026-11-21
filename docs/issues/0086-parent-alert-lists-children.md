# 0086: Parent Down Alert lists Unreachable Children

Spec: 0022
Status: ready-for-agent

**What to build:** A Parent's Down Alert names the Children that are Unreachable when it is sent, so the User knows what is affected.

**Blocked by:** 0085

- [ ] Telegram and ntfy Down Alert: "Also unreachable: Pi, NAS" (nothing when none)
- [ ] Webhook `unreachableChildren: [{ id, name }]`, empty for other kinds and Monitors; `api/openapi.yaml` updated (additive)
- [ ] Up Alert unchanged
- [ ] In-app API docs, landing feature list, CHANGELOG
- [ ] Seam tests on Telegram, ntfy and a Webhook

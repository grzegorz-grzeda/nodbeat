# 0044: Webhook channel

Spec: 0009
Status: ready-for-agent

**What to build:** A User adds a Webhook (URL, optional secret). Alerts are POSTed to it as JSON, signed when a secret is set. Addresses on private networks are refused. A Webhook whose Alerts kept failing is marked Failing in Settings.

**Blocked by:** 0043.

- [ ] Add and edit a Webhook in Settings; the secret is never shown again after saving ("secret set")
- [ ] Down and Up Alerts are POSTed with the documented JSON body; `X-Nodbeat-Signature: sha256=<HMAC>` when a secret is set; any `2xx` counts, 5 s timeout, no redirects followed
- [ ] URLs resolving to private, loopback, link-local, CGNAT or unique-local addresses (v4 and v6) are rejected on save and on every send
- [ ] When the retry window runs out, the Webhook is marked Failing with the last error and keeps getting later Alerts; a delivered Alert clears Failing
- [ ] If issue 0046 has landed: "Send test" works for Webhooks
- [ ] `api/openapi.yaml` documents the Webhook body and signature
- [ ] Tests through the HTTP seam with a fake HTTP sender: signed Down Alert verifies; `http://127.0.0.1` and a name resolving to `10.x` rejected; an hour of failures → Failing, next success clears it

# 0046: Send test Alert

Spec: 0009
Status: resolved

**What to build:** Every Alert channel in Settings has a "Send test" button that delivers a test Alert straight away and shows whether it got through, so a User can check a setup without a Monitor going Down.

**Blocked by:** 0043.

- [ ] "Send test" on every Alert channel, whatever its kind; the result is shown as a Flash message
- [ ] Sent directly, not through the outbox; no retries
- [ ] A successful test clears Failing
- [ ] Limited per User (5 per minute)
- [ ] Tests through the HTTP seam: test to a Linked chat arrives; a failed send shows the error; the 6th test in a minute is refused; another User's channel `404`

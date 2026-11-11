# 0030: Silent Up Alerts

Spec: 0005
Status: ready-for-agent

**What to build:** Up Alerts arrive without a sound, so a recovery doesn't wake the User; Down Alerts still notify.

**Blocked by:** 0029 (it adds send options).

- [x] Up Alerts sent with `disable_notification: true`; Down Alerts without it
- [x] Tests through the HTTP seam: the fake records the option on the Up Alert only

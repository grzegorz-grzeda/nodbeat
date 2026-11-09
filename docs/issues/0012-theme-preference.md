# 0012: Theme preference

Spec: 0002
Status: ready-for-agent

**What to build:** Each User picks light, dark or system with a 3-way switch in the nav. The choice is stored on the User and applied from the first paint.

**Blocked by:** 0011.

- [ ] `theme` on the User: `"light" | "dark" | "system"`, missing = `"system"`
- [ ] `POST /settings/theme` (CSRF) saves it and redirects back; JS enhances to save without reload
- [ ] `<html data-theme>` rendered from the User's theme; logged-out pages render `system`
- [ ] Tests: saving each value, rejecting an unknown value, CSRF required, logged-out pages are `system`

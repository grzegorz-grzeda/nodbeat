# 0032: Admin page and totals

Spec: 0006
Status: ready-for-agent

**What to build:** An Admin-only `/admin` page behind a new `requireAdmin` guard, linked from the nav for the Admin only, showing instance totals.

**Blocked by:** none.

- [ ] `requireAdmin` preHandler in `src/auth.ts`; a visitor and a non-Admin both get the 404 error page (no login redirect)
- [ ] "Admin" nav link rendered only for an Admin
- [ ] Totals: Users, Monitors by Monitor state, Linked chats, Heartbeats in the last 7 days
- [ ] Incidents opened in the last 7 and 30 days
- [ ] Computed per request by aggregation; no new collections
- [ ] Tests through the HTTP seam: visitor and non-Admin → 404; nav shows "Admin" only to the Admin; totals match a seeded scenario with two Users; Heartbeats moved past 7 days with the fake clock aren't counted; a Monitor name seeded with a unique marker never appears

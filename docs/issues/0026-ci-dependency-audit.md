# 0026: Dependency audit in CI

Spec: 0004
Status: ready-for-agent

**What to build:** CI fails when a production dependency has a known high or critical vulnerability.

**Blocked by:** none.

- [x] CI workflow runs `pnpm audit --prod --audit-level=high` after install
- [x] Release workflow inherits it (it calls CI via `workflow_call`)
- [x] Current dependencies pass, or the failures are fixed in this issue

# 0083: Set a Monitor's Parent

Spec: 0022
Status: ready-for-agent

**What to build:** A User picks a Monitor's Parent ("Depends on") on the Monitor form or through the API. No Alert behaviour changes yet.

**Blocked by:** None (can start immediately)

- [ ] `parentId: ObjectId | null` on Monitor, default `null`
- [ ] "Depends on" select on the Monitor form; same User only, not itself, no cycles (chains allowed)
- [ ] Monitor API reads/writes `parentId` with the same checks; `api/openapi.yaml` and in-app API docs updated
- [ ] Deleting a Monitor sets its Children's `parentId` to `null`
- [ ] Monitor page lists its Children
- [ ] Tests for each point
- [ ] If "Download my data" (issue 0075) exists, the export includes `parentId`

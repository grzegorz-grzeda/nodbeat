# 0039: Max run time

Spec: 0007
Status: resolved

**What to build:** A Monitor gets an optional Max run time; an Up Monitor whose Run lasts longer goes Down with an Alert saying it ran too long.

**Blocked by:** 0038.

- [ ] `maxRunTimeSec: number | null` on the Monitor; form field on create and edit, empty = none; bounds 1 min – 1 day in `src/limits.ts`
- [ ] Down checker also moves Up Monitors to Down when `max(runStartedAt, startedAt)` + Max run time has passed; the Incident starts at that moment
- [ ] `IncidentDoc.cause` adds `"run-too-long"`; the Down Alert says "ran longer than <Max run time>"
- [ ] Editing the Max run time counts from the edit (like Interval edits), so it can't backdate an Incident
- [ ] `GLOSSARY.md`: add Max run time; extend Down in Monitor state
- [ ] Tests through the HTTP seam: Max run time 5 min, Start, advance 5 min, tick → Down Alert "ran longer"; success before 5 min → stays Up; no Max run time → only the Interval deadline applies; restart (new `createApp`) during a Run → no Down before startup grace; out-of-bounds value → form error

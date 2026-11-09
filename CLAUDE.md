# nodbeat

A heartbeat for every service and device.

## Rules

- Use [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html) for versioning.
- Track specs in `docs/specs/` and issues in `docs/issues/`. Each has its own repo-wide counter (`0001-slug.md`, ...).
- When a spec or issue is done, rename its file by putting `done-` in front of the name.

## Agent skills

### Issue tracker

Local markdown: specs in `docs/specs/`, issues in `docs/issues/`, each numbered on its own (`NNNN-slug.md`). When finished, a file is renamed with a `done-` prefix. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), recorded as `Status:` lines. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.

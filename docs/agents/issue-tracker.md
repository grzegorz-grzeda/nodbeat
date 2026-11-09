# Issue tracker: Local Markdown

Specs and issues for this repo live as markdown files in `docs/`.

## Layout

```
docs/
├── specs/
│   ├── 0001-heartbeat-protocol.md
│   └── done-0002-device-registry.md
└── issues/
    ├── 0001-define-ping-payload.md
    ├── done-0002-add-ping-endpoint.md
    └── 0003-register-device.md
```

## Numbering

- Specs and issues each have their own sequence, numbered from `0001`, zero-padded to 4 digits.
- Numbering is repo-wide and never resets per feature: the next number is the highest existing number in that directory plus one. Count `done-` files too.
- Numbers are never reused or renumbered.
- File name: `<NNNN>-<slug>.md`.

## Conventions

- **Spec**: `docs/specs/<NNNN>-<slug>.md`.
- **Issue**: `docs/issues/<NNNN>-<slug>.md`, one file per ticket. Never put several tickets in one combined file.
- An issue that belongs to a spec has a `Spec: <NNNN>` line near the top.
- Triage state goes on a `Status:` line near the top of each issue file. The role strings are in `triage-labels.md`.
- Comments and conversation history go at the bottom of the file, under a `## Comments` heading.
- Refer to items as `spec 0001` / `issue 0003`.

## Completion

When a spec or issue is done, rename the file by putting `done-` in front of its name, e.g. `git mv docs/issues/0003-register-device.md docs/issues/done-0003-register-device.md`. Keep the number and the slug. A spec is done once all of its issues are done.

## When a skill says "publish to the issue tracker"

Create a new file in `docs/specs/` or `docs/issues/`, numbered as in **Numbering** above.

## When a skill says "fetch the relevant ticket"

Read the file at the given path, or look up the number in `docs/issues/` (or in `docs/specs/` for a spec). Match the file name with or without the `done-` prefix.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a spec. Each **child** ticket is an issue.

- **Map**: `docs/specs/<NNNN>-<slug>.md`, holding the Notes / Decisions-so-far / Fog sections.
- **Child ticket**: `docs/issues/<NNNN>-<slug>.md` with a `Spec: <NNNN>` line and the question in the body. A `Type:` line holds the ticket type (`research`/`prototype`/`grilling`/`task`). A `Status:` line holds `claimed`/`resolved`.
- **Blocking**: a `Blocked by: <NNNN>, <NNNN>` line near the top. A ticket is unblocked once every issue it lists is resolved (`done-` prefix or `Status: resolved`).
- **Frontier**: look for issues in `docs/issues/` that carry the map's `Spec:` line and are open, unblocked and unclaimed. The lowest number wins.
- **Claim**: set `Status: claimed` and save before doing any work.
- **Resolve**: add the answer under an `## Answer` heading, set `Status: resolved`, and rename the file with the `done-` prefix. Then add a context pointer (gist + link) to the map's Decisions-so-far.

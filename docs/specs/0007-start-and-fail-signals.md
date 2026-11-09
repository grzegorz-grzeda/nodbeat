# Spec 0007: Start and Fail signals

Status: needs-triage

## Problem Statement

Most of what I watch are jobs: backups, cron scripts, data syncs. A Heartbeat only says "it finished". When a job fails, I write `job.sh && curl …`, send nothing, and learn about it an Interval + Grace period later, as if it had never run. A job that hangs looks the same as one that never started. And I can't see how long a job takes, which is often the first sign of trouble (a backup going from 2 to 40 minutes).

## Solution

A Heartbeat URL accepts two more signals. A **Start signal** (`/hb/<token>/start`) says a job began. A **Fail signal** (`/hb/<token>/fail`) says it failed, and the Monitor goes Down at once. A plain Heartbeat after a Start signal ends the **Run**, and nodbeat records its **Run duration**. A Monitor can have an optional **Max run time**: a Run that takes longer makes the Monitor Down.

## User Stories

1. As a job, I want to send a Fail signal with an optional message, so that nodbeat knows straight away that I failed and why.
2. As a User, I want a Fail signal to make the Monitor Down and send a Down Alert at once, so that I don't wait an Interval + Grace period to learn about a failure.
3. As a User, I want a Fail signal to a New Monitor to make it Down too, so that a job failing on its first run isn't silent.
4. As a User, I want a Fail signal to a Down Monitor to be recorded without a second Alert, so that a job failing every 5 minutes doesn't spam me.
5. As a User, I want the Down Alert after a Fail signal to say it reported a failure and include its message, so that I can tell a failure from silence.
6. As a job, I want to send a Start signal when I begin, so that nodbeat can time me.
7. As a User, I want a Start signal not to count as a Heartbeat, so that a job that starts but never finishes still goes Down.
8. As a User, I want each Run's duration shown in the Heartbeats log and the last one on the Monitor page and the Dashboard, so that I see how long jobs take.
9. As a User, I want to set an optional Max run time on a Monitor, so that a job that hangs goes Down instead of looking busy.
10. As a User, I want Start and Fail signals to a Paused Monitor to be recorded and nothing else, so that pausing still means silence.
11. As a job, I want to send a Start signal and a Heartbeat within the same second without a `429`, so that short jobs work.
12. As a User, I want the Monitor page to show a cron example using Start, success and Fail, so that I can wire up a job in one paste.

## Implementation Decisions

- **Routes**: `GET|POST /hb/:token/start` and `GET|POST /hb/:token/fail`, next to `/hb/:token`, with the same message rules, body limit, plain-text answers and `HEAD` → 404. `api/openapi.yaml` documents both.
- **Rate limit**: the 1-per-second limit is kept per token and signal kind, so start → success in one second passes, while two Fail signals in a second get `429`.
- **Heartbeat doc**: gets `kind: "success" | "start" | "fail"` (missing on old docs = success) and `runDurationSec: number | null`.
- **Monitor fields**: `runStartedAt: Date | null` (set by a Start signal, cleared by success or Fail), `lastRunDurationSec: number | null`, and `maxRunTimeSec: number | null` (form field, empty = none; bounded 1 min – 1 day in `src/limits.ts`).
- **State machine**: two new events in `src/monitor-state.ts`, still the single place state changes are decided.
  - `start`: records `runStartedAt`. No state change, does not move `lastHeartbeatAt` or the deadline. A second Start replaces the first (overlapping Runs aren't tracked).
  - `fail`: New or Up → Down with an `open-incident` effect starting now and a Down Alert (if Alerts are on); New also ends its New period. Down → only recorded. Paused → only recorded. A Fail signal updates `lastHeartbeatAt` and `lastMessage` (the device is alive and talking), so the Interval deadline doesn't open a second Incident later.
  - `heartbeat` (success) after a Start: also ends the Run and computes its duration.
- **Max run time**: the Down checker also moves Up Monitors to Down when `runStartedAt` + Max run time has passed, with the Incident starting at that moment. Startup grace applies as for the Interval: counted from the later of `runStartedAt` and nodbeat's start.
- **Incident cause**: `IncidentDoc` gets `cause: "missed" | "failed" | "run-too-long"` (missing = missed). The Down Alert text says "is Down" / "reported a failure" / "ran longer than <Max run time>"; for a failure it includes the Fail signal's message. If spec 0005's richer Alerts (issue 0029) has landed, the same format is used.
- **Display**: Heartbeats log gets a "Signal" column (✓ / Start / Fail) and the Run duration; Monitor page and Dashboard show the last Run duration when there is one.
- **Example on the Monitor page**:

  ```sh
  curl -fsS -m 10 <url>/start; /path/to/job.sh && curl -fsS -m 10 <url> || curl -fsS -m 10 <url>/fail
  ```

## Glossary Additions

Add to `GLOSSARY.md` when this ships:

- **Start signal**: a request to `<Heartbeat URL>/start` saying a job began. Not a Heartbeat.
- **Fail signal**: a request to `<Heartbeat URL>/fail` saying a job failed. Makes the Monitor Down at once.
- **Run**: from a Start signal to the next Heartbeat or Fail signal. Its length is the **Run duration**.
- **Max run time**: optional per-Monitor limit on a Run; a longer Run makes the Monitor Down.
- **Monitor state**, Down: extend to "or a Fail signal, or a Run longer than its Max run time".

## Testing Decisions

- Same single seam: `createApp`, Fastify `inject`, the fake clock, real Mongo in memory, the recording Telegram fake.
- Pure tests of `transition` for `start` and `fail` from every state.
- Scenarios: Up → Fail → Down Alert with "reported a failure" and the message → success → Up Alert; New → Fail → Down; Down → Fail → no second Alert; Start, advance 42 s, success → "42 s" in the log, Monitor page and Dashboard JSON; Start with Max run time 5 min, advance 5 min, tick → Down "ran longer"; Start + success in the same second → both `200`; Paused + Fail → no Alert, state stays Paused; restart (new `createApp`) during a Run → no Down before startup grace.

## Out of Scope

- Exit codes in the URL (`/hb/<token>/<code>`) and uploading job output.
- A wrapper CLI (`nodbeat run -- job.sh`).
- Cron-expression schedules.
- Run duration charts and alerts on duration trends.

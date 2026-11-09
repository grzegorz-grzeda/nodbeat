# Single always-on process on the private VPS

nodbeat runs as one always-on Node process on the owner's private VPS, at `nodbeat.g2labs.pl`. That one process serves the web page, takes in Heartbeats, receives the Telegram webhook, runs the Down checker and Alert dispatcher every 10 s and sends its own self-Heartbeat every minute. Down detection needs a timer that runs all the time, which serverless platforms provide only through coarse (≥1 min), rate-limited cron jobs. The VPS already exists and runs Docker with Caddy, so it adds no cost.

## Consequences

- While nodbeat itself is down, no Heartbeats are received and no Alerts are sent. After a restart, no Monitor may be marked Down until it has had a full Interval + Grace period to check in, so the restart doesn't trigger a flood of false Alerts.
- Running a second instance would require locking around the Down checker. Out of scope for now.

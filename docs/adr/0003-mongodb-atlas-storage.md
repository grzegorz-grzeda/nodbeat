# MongoDB Atlas for storage, raw Heartbeats kept 7 days

All data lives in MongoDB Atlas, starting on the free M0 tier, rather than in a database on the VPS. The owner already has an Atlas account, the VPS is small, and the data survives if the VPS is lost. M0 caps storage at 512 MB. A Monitor sending one Heartbeat a minute produces about 10k raw Heartbeats a week, so raw Heartbeats are removed after 7 days by a TTL index. Monitor state and last-seen time are kept permanently.

Amended (0.16.0): each Monitor also keeps only its 100 newest Heartbeats and its 100 newest Incidents. Older Incidents are dropped once they ended before the 7-day Uptime window, so Uptime is unaffected. Pruning runs on the 10 s tick, not in Heartbeat intake, so a Heartbeat still costs one update plus one insert.

## Consequences

- M0 has no automated backups, so a scheduled `mongodump` is needed. Raw Heartbeats are optional in that backup.
- Every write is a network round trip from the VPS to Atlas. Heartbeat intake must stay cheap (one update plus one insert).

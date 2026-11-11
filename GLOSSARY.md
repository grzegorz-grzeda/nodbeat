# nodbeat

nodbeat collects Heartbeats from things a User wants to watch and alerts the User when one goes silent and when it comes back.

## Monitoring

**Monitor**:
Something a User watches: a service, script, server or IoT device. Each Monitor has its own Heartbeat URL.
_Avoid_: Device, service, check, probe, target

**Heartbeat**:
A single signal that a Monitor is alive, sent by the monitored thing to its Heartbeat URL. It may carry a short text message.
_Avoid_: Ping, check-in, beat

**Heartbeat URL**:
The secret, unguessable address a Monitor's Heartbeats are sent to. Anyone who knows it can send Heartbeats for that Monitor.
_Avoid_: Ping URL, endpoint, webhook

**Fail signal**:
A request to `<Heartbeat URL>/fail` saying a job failed. Makes the Monitor Down at once. It may carry a short text message, which the Down Alert includes.
_Avoid_: Error ping, failure Heartbeat

**Start signal**:
A request to `<Heartbeat URL>/start` saying a job began. Not a Heartbeat: it changes no Monitor state and does not move the deadline.
_Avoid_: Start ping, begin Heartbeat

**Run**:
One job execution, from a Start signal to the next Heartbeat or Fail signal. A second Start signal before then replaces the first.
_Avoid_: Job, execution

**Run duration**:
How long a Run took: from its Start signal to the Heartbeat or Fail signal that ended it, in whole seconds.
_Avoid_: Runtime, elapsed time

**Max run time**:
An optional per-Monitor limit on a Run. An Up Monitor whose Run lasts longer goes Down, counted from the Start signal (or nodbeat's start, an unpause or an edit, whichever is latest).
_Avoid_: Timeout, run limit

**Interval**:
How often a Monitor is expected to send a Heartbeat. A Monitor has either an Interval or a Schedule, never both.
_Avoid_: Period, frequency

**Schedule**:
The times of day and week a Monitor is expected to send a Heartbeat (e.g. 02:00 on weekdays), read in the Monitor's own time zone. An alternative to an Interval for jobs that run at fixed times.
_Avoid_: Cron, timetable, plan

**Scheduled time**:
One of the times a Schedule expects a Heartbeat. A Heartbeat counts for the coming scheduled time if it is at most 1 h before it (or half the gap from the scheduled time before, if that is shorter), otherwise for the one before it. The Monitor then waits for the scheduled time after that, + Grace period.
_Avoid_: Run, occurrence, firing

**Grace period**:
Extra time allowed after the Interval or the scheduled time before a missing Heartbeat makes the Monitor Down.
_Avoid_: Tolerance, timeout

**Monitor state**:
One of **New** (no Heartbeat received yet, or none during the pause it was just unpaused from), **Up** (Heartbeats arriving on time), **Down** (Interval or scheduled time + Grace period passed with no Heartbeat, or a Fail signal, or a Run longer than its Max run time) or **Paused** (deliberately not watched: never goes Down, sends no Alerts).
_Avoid_: Status, health

**New period**:
A stretch of time a Monitor spent New, from its creation or the unpause that left it New to its next Heartbeat or pause. Kept so Uptime can leave it out.

**Pause period**:
A stretch of time a Monitor spent Paused, from pause to unpause. Kept so Uptime can leave it out.

**Incident**:
A period during which a Monitor was Down, from the moment it went Down to the Heartbeat that brought it back Up.
_Avoid_: Outage, downtime event, alert

**Uptime**:
The share of a time window a Monitor spent Up, out of the time it spent Up or Down. Time spent New or Paused is left out.
_Avoid_: Availability, SLA

**Dashboard**:
The page where a User sees the live Monitor state of all their Monitors.
_Avoid_: Overview, home, status page

## Notifications

**Alert**:
A message sent to a Monitor's Alert channels when it goes Down or comes back Up. Not sent while the Monitor's Alerts are switched off.
_Avoid_: Notification, ping

**Test Alert**:
An Alert a User sends to one of their Alert channels from Settings, to check it works. It is about no Monitor, is sent once (never retried), and getting through clears Failing.
_Avoid_: Test notification, ping, Test message

**Reminder**:
An Alert repeated at a fixed cadence (1, 6 or 24 h) while a Monitor stays Down, for Monitors that ask for one. Stops when the Monitor comes back Up, is paused, or has its Alerts switched off.
_Avoid_: Re-alert, escalation, nag

**Alert channel**:
A place a User has set up to receive Alerts: a Linked chat, a Webhook or an ntfy topic.
_Avoid_: Integration, destination, target, notifier

**Alert channels** (of a Monitor):
The Alert channels a Monitor's Alerts go to: either all of its owner's Alert channels, including ones added later, or a chosen few. A Monitor whose chosen channels were all removed alerts nowhere.
_Avoid_: Recipients, routes, Alert chats

**Webhook**:
An Alert channel that delivers each Alert as an HTTP request to an address the User gives.
_Avoid_: Callback, hook, endpoint

**ntfy topic**:
An Alert channel that delivers each Alert as a push notification through an ntfy server (ntfy.sh or self-hosted).
_Avoid_: Push channel

**Failing**:
An Alert channel whose recent Alerts could not be delivered. It keeps receiving Alerts; it is only flagged so its User can fix it.
_Avoid_: Broken, dead, disabled

**Linked chat**:
An Alert channel that is a Telegram chat (private or group) a User has connected to their account.
_Avoid_: Subscriber, Telegram channel

**Link code**:
A short one-time code a User sends to the nodbeat bot to create a Linked chat.
_Avoid_: Pairing code, token

## Accounts

**User**:
A person with a nodbeat account who owns Monitors and Alert channels. A User may delete their own account, which removes everything they own.
_Avoid_: Account, customer, member

**Login method**:
A way a User logs in: a password, a Google account or a GitHub account. A User has at least one and can't remove the last.
_Avoid_: Identity, provider, SSO, social login

**Plan**:
What a User's account is entitled to: how many Monitors, how short an Interval, which Alert channels and features, how many log entries are kept. Either **Free** or **Pro** (paid). On a self-hosted instance without billing, Plans don't apply.
_Avoid_: Tier, subscription, package, license

**Admin**:
A User who can manage the whole nodbeat instance, not just their own Monitors.
_Avoid_: Superuser, root, owner

**Invite**:
A single-use link from the Admin that lets one person create a User. It expires after 7 days and can be revoked.
_Avoid_: Registration, sign-up code, token

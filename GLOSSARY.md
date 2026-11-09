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

**Interval**:
How often a Monitor is expected to send a Heartbeat.
_Avoid_: Period, frequency

**Grace period**:
Extra time allowed after the Interval before a missing Heartbeat makes the Monitor Down.
_Avoid_: Tolerance, timeout

**Monitor state**:
One of **New** (no Heartbeat received yet, or none during the pause it was just unpaused from), **Up** (Heartbeats arriving on time), **Down** (Interval + Grace period passed with no Heartbeat) or **Paused** (deliberately not watched: never goes Down, sends no Alerts).
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
A message sent to a User's Linked chats when one of their Monitors goes Down or comes back Up.
_Avoid_: Notification, ping

**Linked chat**:
A Telegram chat (private or group) that a User has connected to their account to receive Alerts.
_Avoid_: Subscriber, channel

**Link code**:
A short one-time code a User sends to the nodbeat bot to create a Linked chat.
_Avoid_: Pairing code, token

## Accounts

**User**:
A person with a nodbeat account who owns Monitors and Linked chats.
_Avoid_: Account, customer, member

**Admin**:
A User who can manage the whole nodbeat instance, not just their own Monitors.
_Avoid_: Superuser, root, owner

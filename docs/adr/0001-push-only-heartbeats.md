# Push-only Heartbeats in v1

In v1, Monitors are watched only through Heartbeats that the monitored thing sends to its Heartbeat URL. nodbeat never connects to the things it watches. The audience is electronics and programming hobbyists, and their IoT devices usually sit behind NAT or switch on only now and then, so nodbeat can't reach them, while they can always make an outbound HTTPS request. Push also keeps nodbeat from being turned into a tool that sends traffic to arbitrary hosts.

## Considered Options

- **Pull (nodbeat polls a URL, like UptimeRobot)**: rejected for v1 because NAT'd devices can't be reached and it opens an SSRF/abuse surface. It may come back later as a second kind of Monitor.

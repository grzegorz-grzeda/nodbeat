# Shared edge Caddy outside this repo

nodbeat ships no reverse proxy of its own. On the VPS, one Caddy in a separate "edge" Compose project owns ports 80/443 and terminates TLS for every project, including `nodbeat.g2labs.pl`. App containers join the shared Docker network `edge` and publish no ports. Only one process can bind 80/443, and take-a-look already ran Caddy. Extracting it means neither app's repo owns the other's routing.

## Considered Options

- **Join take-a-look's network and add a site block to its Caddyfile**: rejected because it ties nodbeat's deployment to another project's repo.

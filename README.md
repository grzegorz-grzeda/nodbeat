# nodbeat

A heartbeat for every service and device

## Creating a User

There is no registration. Create Users (the first one with `--admin`) from the CLI. The password is read from stdin, so it never lands in shell history:

```sh
docker compose exec -it nodbeat node dist/cli-main.js create-user --email you@example.com --admin [--time-zone Europe/Warsaw]
```

Only `MONGODB_URI` is needed by the CLI.

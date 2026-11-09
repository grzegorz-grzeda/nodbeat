import { parseArgs } from "node:util";
import type { Db } from "mongodb";
import { systemClock } from "./clock.js";
import { createUser, ensureUserIndexes, UserError } from "./users.js";

export interface CliDeps {
  db: Db;
  /** Asks for the password without putting it on the command line. */
  readPassword: () => Promise<string>;
  write: (text: string) => void;
}

const USAGE = `Usage:
  node dist/cli-main.js create-user --email <email> [--admin] [--time-zone <IANA zone>]
    The password is read from stdin (prompted when interactive).
`;

/** Runs one admin command. Returns the process exit code. */
export async function runCli(args: string[], deps: CliDeps): Promise<number> {
  const [command, ...rest] = args;
  if (command !== "create-user") {
    deps.write(USAGE);
    return 2;
  }

  let values: { email?: string; admin?: boolean; "time-zone"?: string };
  try {
    ({ values } = parseArgs({
      args: rest,
      options: {
        email: { type: "string" },
        admin: { type: "boolean", default: false },
        "time-zone": { type: "string" },
      },
    }));
  } catch (err) {
    deps.write(`${(err as Error).message}\n${USAGE}`);
    return 2;
  }
  if (!values.email) {
    deps.write(`--email is required\n${USAGE}`);
    return 2;
  }

  try {
    await ensureUserIndexes(deps.db);
    const user = await createUser(deps.db, systemClock, {
      email: values.email,
      password: await deps.readPassword(),
      isAdmin: values.admin ?? false,
      ...(values["time-zone"] ? { timeZone: values["time-zone"] } : {}),
    });
    deps.write(
      `Created User ${user.email}${user.isAdmin ? " (Admin)" : ""}, time zone ${user.timeZone}\n`,
    );
    return 0;
  } catch (err) {
    if (err instanceof UserError) {
      deps.write(`${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

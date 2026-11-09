import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { MongoClient } from "mongodb";
import { runCli } from "./cli.js";

/** Reads one line from stdin; when it's a terminal, prompts and hides what is typed. */
async function readPassword(): Promise<string> {
  const interactive = Boolean(process.stdin.isTTY);
  let muted = false;
  const output = new Writable({
    write(chunk, _enc, done) {
      if (!muted) process.stdout.write(chunk);
      done();
    },
  });
  const rl = createInterface({
    input: process.stdin,
    output,
    terminal: interactive,
  });
  try {
    const answer = rl.question(interactive ? "Password: " : "");
    muted = true;
    const password = await answer;
    if (interactive) process.stdout.write("\n");
    return password;
  } finally {
    rl.close();
  }
}

async function main(): Promise<number> {
  const mongoUri = process.env.MONGODB_URI?.trim();
  if (!mongoUri) {
    console.error("MONGODB_URI is required");
    return 2;
  }
  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5_000 });
  await client.connect();
  try {
    return await runCli(process.argv.slice(2), {
      db: client.db(),
      readPassword,
      write: (text) => process.stdout.write(text),
    });
  } finally {
    await client.close();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);

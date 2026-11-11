import { MongoMemoryServer } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

export default async function setup(project: TestProject) {
  // TTL indexes (sessions, link codes) expire by the real wall clock, but the
  // tests run on a fake clock set in the past, so a TTL pass during a slow run
  // would delete live test sessions. Expiry is checked in code against the
  // clock anyway; the TTL index is only cleanup.
  const mongo = await MongoMemoryServer.create({
    instance: { args: ["--setParameter", "ttlMonitorEnabled=false"] },
  });
  project.provide("mongoUri", mongo.getUri());
  return async () => {
    await mongo.stop();
  };
}

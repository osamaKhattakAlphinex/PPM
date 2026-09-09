import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

// Registers the global base plugin before any fixture model is compiled.
import "../../mongoose-setup";

/**
 * A throwaway mongod for the data-access tests.
 *
 * The isolation guarantees are about what MongoDB actually returns, so they are
 * tested against a real server rather than a mocked query. A stubbed model
 * would only prove that we build the filter we think we build; this proves the
 * database agrees.
 */
let server: MongoMemoryServer | undefined;

/**
 * A mongod that is already running, if the environment provides one.
 *
 * `MongoMemoryServer` downloads a `mongod` binary on first use. That is right
 * on a developer's machine and wrong wherever a MongoDB is already reachable
 * and the download is not: a CI runner, where a service container has started
 * one and the download is pure latency, or any network that blocks the download
 * host — there the fifteen database suites cannot start at all, which reads
 * like fifteen failures rather than one missing binary.
 *
 * So `MONGO_TEST_URI` wins when it is set, and nothing else changes. The tests
 * are identical either way: they are about what MongoDB actually returns, and
 * both paths are MongoDB.
 */
const externalUri = process.env.MONGO_TEST_URI?.trim();

/**
 * One database per worker.
 *
 * Each suite gets its own throwaway server on the download path, so nothing
 * shares state. A single external server would break that: vitest runs suites
 * in parallel, `clearCollections` wipes everything it can see, and two suites
 * on one database would delete each other's fixtures — intermittently, which is
 * the worst way for it to happen. Files inside one worker run sequentially, so
 * partitioning by worker is enough.
 */
function databaseName(): string {
  const worker =
    process.env.VITEST_POOL_ID ??
    process.env.VITEST_WORKER_ID ??
    String(process.pid);
  return `ppm_dal_test_${worker}`;
}

export async function startMemoryMongo(): Promise<string> {
  let uri: string;

  if (externalUri) {
    uri = externalUri;
  } else {
    server = await MongoMemoryServer.create();
    uri = server.getUri();
  }

  await mongoose.connect(uri, {
    dbName: databaseName(),
    bufferCommands: false,
  });
  return uri;
}

export async function stopMemoryMongo(): Promise<void> {
  // Leave a shared external server running — stopping someone else's mongod is
  // not this helper's to do — but do not leave this worker's database behind on
  // it. Guarded on the connection actually being open: when `startMemoryMongo`
  // failed to connect, an unguarded drop throws from `afterAll` and buries the
  // real error under a second one.
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
  }

  await mongoose.disconnect();
  await server?.stop();
  server = undefined;
}

/**
 * Wipe every collection between tests.
 *
 * Uses the raw driver on purpose: test setup is not tenant-scoped work, and
 * routing it through the DAL would mean the fixtures inherit the very rules
 * under test.
 */
export async function clearCollections(): Promise<void> {
  const { collections } = mongoose.connection;
  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({})),
  );
}

import mongoose, { type ConnectOptions, type Mongoose } from "mongoose";

import { getServerEnv } from "../env";

// Sets strictQuery and registers the global base plugin. Imported for the side
// effect, and imported here so that connecting is enough to configure Mongoose.
import "./mongoose-setup";

/**
 * A single cached connection, shared across:
 *
 *  - hot reloads in `next dev`, which re-evaluate modules in the same process
 *    and would otherwise open a new pool on every save until Mongo refuses;
 *  - warm serverless invocations, where the container survives between
 *    requests and reconnecting per request costs a full TLS + auth handshake.
 *
 * The in-flight promise is cached too, so concurrent callers during a cold
 * start await one connection attempt rather than racing to open several.
 */
interface MongooseCache {
  conn: Mongoose | null;
  promise: Promise<Mongoose> | null;
}

declare global {
  var __ppmMongooseCache: MongooseCache | undefined;
}

const cache: MongooseCache = globalThis.__ppmMongooseCache ?? { conn: null, promise: null };
globalThis.__ppmMongooseCache = cache;

/** Generic by design: a Mongo error must never reach the client. */
export class DatabaseConnectionError extends Error {
  readonly code = "DB_CONNECTION_FAILED";

  constructor() {
    super("The database is unavailable.");
    this.name = "DatabaseConnectionError";
  }
}

function buildConnectOptions(): ConnectOptions {
  const env = getServerEnv();

  return {
    dbName: env.MONGODB_DB_NAME,

    // Fail a query immediately when there is no connection instead of buffering
    // it. On serverless, a buffered query outlives the request and the caller
    // sees a timeout with no useful error.
    bufferCommands: false,

    maxPoolSize: env.MONGODB_MAX_POOL_SIZE,
    minPoolSize: env.MONGODB_MIN_POOL_SIZE,
    serverSelectionTimeoutMS: env.MONGODB_SERVER_SELECTION_TIMEOUT_MS,
    socketTimeoutMS: env.MONGODB_SOCKET_TIMEOUT_MS,

    // Index builds belong in a migration, not in a request path.
    autoIndex: env.MONGODB_AUTO_INDEX,
    autoCreate: env.MONGODB_AUTO_INDEX,

    retryWrites: true,
    appName: "ppm-platform",
  };
}

let listenersAttached = false;

function attachConnectionListeners(): void {
  if (listenersAttached) return;
  listenersAttached = true;

  // Server-side logging only. Never surfaced to a client response.
  mongoose.connection.on("error", (error: unknown) => {
    console.error("[db] connection error", error);
  });
  mongoose.connection.on("disconnected", () => {
    console.warn("[db] disconnected");
    cache.conn = null;
    cache.promise = null;
  });
}

/**
 * Resolve the shared connection, opening it on first use.
 *
 * Call this at the top of every Server Component read, Server Action, and Route
 * Handler that touches the database. It is cheap once warm.
 */
export async function connectToDatabase(): Promise<Mongoose> {
  if (typeof window !== "undefined") {
    throw new Error("connectToDatabase() is server-only and was called in the browser.");
  }

  // readyState 1 === connected. A cached-but-dropped connection is rebuilt.
  if (cache.conn && cache.conn.connection.readyState === 1) {
    return cache.conn;
  }

  if (!cache.promise) {
    attachConnectionListeners();
    const uri = getServerEnv().MONGODB_URI;
    cache.promise = mongoose.connect(uri, buildConnectOptions());
  }

  try {
    cache.conn = await cache.promise;
  } catch (error) {
    // Clear the failed attempt so the next request retries rather than
    // awaiting a permanently rejected promise.
    cache.promise = null;
    cache.conn = null;
    console.error("[db] failed to connect", error);
    throw new DatabaseConnectionError();
  }

  return cache.conn;
}

/** For test teardown and one-off scripts. Not for request handling. */
export async function disconnectFromDatabase(): Promise<void> {
  if (!cache.conn && !cache.promise) return;
  await mongoose.disconnect();
  cache.conn = null;
  cache.promise = null;
}

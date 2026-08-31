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

export async function startMemoryMongo(): Promise<string> {
  server = await MongoMemoryServer.create();
  const uri = server.getUri();

  await mongoose.connect(uri, { dbName: "ppm_dal_test", bufferCommands: false });
  return uri;
}

export async function stopMemoryMongo(): Promise<void> {
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
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
}

import { loadEnvConfig } from "@next/env";
import mongoose from "mongoose";

/**
 * Read `.env.local` exactly the way `next dev` does, so the script and the app
 * always talk to the same database. Must run before the imports below.
 */
loadEnvConfig(process.cwd());

// Importing the data-access layer's entry point compiles every model, which is
// what puts them in `mongoose.models` for the loop at the bottom.
import { connectToDatabase, disconnectFromDatabase } from "../src/lib/db";

/**
 * Build the declared indexes, deliberately.
 *
 *     pnpm indexes            # create anything missing
 *     pnpm indexes --prune    # ...and drop anything no longer declared
 *
 * Production runs with `MONGODB_AUTO_INDEX=false`, so Mongoose does not build
 * indexes when a model is compiled. That is not caution for its own sake: an
 * index build on a large collection holds a lock, and a deploy that happens to
 * trigger one is a deploy that takes the product down for as long as the build
 * takes. Making it a separate command means someone chooses the moment.
 *
 * The default is `createIndexes`, which only ADDS. `--prune` switches to
 * `syncIndexes`, which also drops any index the schema no longer declares —
 * correct after an index is removed in code, and destructive if it is run
 * against a database some other deploy is still serving from. Hence the flag.
 */

const prune = process.argv.includes("--prune");

async function main(): Promise<void> {
  await connectToDatabase();

  const names = Object.keys(mongoose.models).sort();
  if (names.length === 0) {
    throw new Error(
      "No models were registered — did the data-access layer fail to import?",
    );
  }

  console.log(
    `${prune ? "Syncing" : "Building"} indexes for ${names.length} models on ` +
      `${mongoose.connection.name}…\n`,
  );

  for (const name of names) {
    const model = mongoose.models[name];
    if (!model) continue;

    const started = Date.now();

    if (prune) {
      const dropped = await model.syncIndexes();
      const suffix =
        dropped.length > 0 ? ` (dropped ${dropped.join(", ")})` : "";
      console.log(
        `  ${name.padEnd(18)} synced in ${Date.now() - started}ms${suffix}`,
      );
    } else {
      await model.createIndexes();
      console.log(`  ${name.padEnd(18)} built in ${Date.now() - started}ms`);
    }
  }

  // What actually exists now, so the run is its own verification rather than a
  // claim that it worked.
  console.log("\nIndexes now on each collection:\n");
  for (const name of names) {
    const model = mongoose.models[name];
    if (!model) continue;

    const indexes: Array<{ name?: string }> = await model.collection.indexes();
    console.log(
      `  ${name}: ${indexes.map((index) => index.name ?? "?").join(", ")}`,
    );
  }
}

main()
  .then(async () => {
    await disconnectFromDatabase();
    console.log("\nDone.");
  })
  .catch(async (error: unknown) => {
    console.error("\nIndex build failed:", error);
    await disconnectFromDatabase().catch(() => undefined);
    process.exitCode = 1;
  });

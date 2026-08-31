import mongoose from "mongoose";

import { basePlugin } from "./base-plugin";

/**
 * Process-wide Mongoose configuration.
 *
 * Everything here must run BEFORE the first model is compiled, so both
 * `connect.ts` and `define-model.ts` import this module and it configures on
 * import. The flag lives on `globalThis` so a Next.js hot reload — which
 * re-evaluates modules against the same process — does not re-register the
 * global plugin and double-apply it.
 */
declare global {
  var __ppmMongooseConfigured: true | undefined;
}

function configureMongoose(): void {
  if (globalThis.__ppmMongooseConfigured) return;

  // Query conditions on paths not in the schema are stripped instead of being
  // sent to MongoDB. A typo'd or injected field can never widen a result set.
  mongoose.set("strictQuery", true);

  // Unknown paths on a write throw instead of being silently dropped, so a
  // mismatch between a zod schema and its Mongoose schema surfaces loudly.
  mongoose.set("strict", "throw");

  // Defence in depth alongside our own `sanitize()`. Mongoose wraps any filter
  // VALUE that contains a `$` key in `$eq`, so `{ email: { $gt: "" } }` is
  // matched literally instead of being executed as an operator.
  //
  // IMPORTANT for the data-access layer: this applies to our own queries too.
  // A code-authored operator must be marked trusted, or it is neutralised and
  // the query silently matches nothing:
  //
  //     Model.find({ createdAt: mongoose.trusted({ $gte: since }) })
  //
  // That is the intended trade-off — an operator has to be opted into
  // explicitly, and forgetting to do so fails closed rather than open.
  mongoose.set("sanitizeFilter", true);

  // Never queue a query against a connection that is not open. A buffered
  // query outlives its request on serverless and surfaces as an opaque
  // timeout; failing immediately points at the missing connectToDatabase().
  mongoose.set("bufferCommands", false);

  // Validators run on findOneAndUpdate/updateOne as well as save.
  mongoose.set("runValidators", true);

  // Global plugins would otherwise be applied to subdocument schemas too,
  // giving every nested object its own organizationId and timestamps.
  mongoose.set("applyPluginsToChildSchemas", false);

  mongoose.plugin(basePlugin);

  globalThis.__ppmMongooseConfigured = true;
}

configureMongoose();

export { configureMongoose };

import mongoose, { type Model } from "mongoose";
import type { z } from "zod";

import { buildSchema, type BuildSchemaOptions, type DocumentOf } from "./zod-mongoose";

// Must run before any model is compiled: registers the global base plugin.
import "./mongoose-setup";

/**
 * Compile a model from its zod schema.
 *
 * Reuses an already-compiled model when one exists, because `next dev`
 * re-evaluates modules on every save and Mongoose throws
 * `OverwriteModelError` the second time a name is registered.
 */
export function defineModel<T extends z.ZodObject>(
  name: string,
  zodSchema: T,
  options: BuildSchemaOptions = {},
): Model<DocumentOf<T>> {
  const existing = mongoose.models[name] as Model<DocumentOf<T>> | undefined;
  if (existing) return existing;

  const schema = buildSchema(zodSchema, options);
  return mongoose.model<DocumentOf<T>>(name, schema);
}

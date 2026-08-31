/**
 * The lint half of the data-isolation rule in CLAUDE.md.
 *
 * The DAL can only guarantee tenant scoping for queries that go through it, so
 * the boundary has to be enforced mechanically rather than by review. Three
 * layers, deliberately overlapping:
 *
 *   1. no direct `Model.find(...)`-shaped calls outside `src/lib/db/**`
 *   2. no importing `mongoose` outside `src/lib/db/**`
 *   3. no importing a model module outside `src/lib/db/**`
 *
 * Layer 1 alone is defeated by aliasing the model (`const m = Note; m.find()`);
 * layers 2 and 3 close that off by making the model unreachable in the first
 * place. Together, a feature file cannot obtain a model to call anything on.
 *
 * Exported from a plain module so `eslint.config.mjs` and the test that proves
 * the rule actually fires read the same definition.
 */

/** Mongoose Model/Query methods that reach the database. */
export const MODEL_QUERY_METHODS = [
  "aggregate",
  "bulkSave",
  "bulkWrite",
  "count",
  "countDocuments",
  "createCollection",
  "deleteMany",
  "deleteOne",
  "distinct",
  "estimatedDocumentCount",
  "find",
  "findById",
  "findByIdAndDelete",
  "findByIdAndRemove",
  "findByIdAndUpdate",
  "findOne",
  "findOneAndDelete",
  "findOneAndRemove",
  "findOneAndReplace",
  "findOneAndUpdate",
  "insertMany",
  "insertOne",
  "replaceOne",
  "updateMany",
  "updateOne",
  "watch",
];

const METHOD_PATTERN = `^(${MODEL_QUERY_METHODS.join("|")})$`;

/**
 * Matches `Something.find(...)` where `Something` is PascalCase — the naming
 * every Mongoose model in this codebase uses. Restricting to PascalCase is what
 * keeps `array.find(...)` and `params.get(...)` out of the rule; a lowercase
 * receiver is not a model by our conventions, and layers 2/3 catch the case
 * where someone renames one to dodge this.
 */
const MODEL_CALL_SELECTOR =
  `CallExpression[callee.type="MemberExpression"]` +
  `[callee.object.type="Identifier"]` +
  `[callee.object.name=/^[A-Z][A-Za-z0-9]*$/]` +
  `[callee.property.name=/${METHOD_PATTERN}/]`;

const MODEL_CALL_MESSAGE =
  "Direct Mongoose model access is not allowed outside src/lib/db. " +
  "Use a repository from createRepository() — it injects organizationId " +
  "(and clientId for CLIENT users) into every query. See CLAUDE.md > Data isolation.";

/** `no-restricted-syntax` entries. Applied to feature code, not to the DAL. */
export const restrictedModelCallSyntax = [
  { selector: MODEL_CALL_SELECTOR, message: MODEL_CALL_MESSAGE },
  {
    // Any reach through the mongoose namespace — `mongoose.model("X")`,
    // `mongoose.connection.db.collection(...)`, `mongoose.Types` — re-opens the
    // door, so the member access itself is what gets flagged, not the call.
    selector: `MemberExpression[object.name="mongoose"]`,
    message: MODEL_CALL_MESSAGE,
  },
];

/** `no-restricted-imports` config. Applied to feature code, not to the DAL. */
export const restrictedDatabaseImports = {
  paths: [
    {
      name: "mongoose",
      message:
        "Import from @/lib/db instead. Feature code must not reach Mongoose directly " +
        "— see CLAUDE.md > Data isolation.",
    },
  ],
  patterns: [
    {
      group: ["**/lib/db/models/*", "@/lib/db/models/*"],
      message:
        "Do not import a Mongoose model. Import the repository for that entity " +
        "instead — see CLAUDE.md > Data isolation.",
    },
  ],
};

/** Files allowed to touch Mongoose directly: the DAL itself, and its tests. */
export const DAL_INTERNAL_FILES = ["src/lib/db/**"];

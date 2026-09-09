import { z } from "zod";

/**
 * The four analyses, as a vocabulary.
 *
 * A PURE module so the analysis cards — Client Components — can import these as
 * VALUES without dragging the route's data-gathering (and therefore Mongoose,
 * and therefore `fs` and `net`) into the browser bundle. The same rule every
 * `src/lib/domain/*` file follows.
 *
 * Pure: zod and four strings. Safe from anywhere.
 */
export const AI_ANALYSES = [
  /** Which equipment is most likely to fail next, and why. */
  "FAILURE_RISK",
  /** Assets that keep breaking in the same way — a symptom of a root cause. */
  "BREAKDOWN_PATTERNS",
  /** Where the preventive plan is over- or under-serving the equipment. */
  "PM_OPTIMIZATION",
  /** What to hold in stores, based on what has actually been consumed. */
  "SPARE_PARTS",
] as const;

export type AiAnalysis = (typeof AI_ANALYSES)[number];

export const aiAnalysisSchema = z.enum(AI_ANALYSES);

/**
 * The locale the answer is written in.
 *
 * Sent explicitly rather than read from the request header, because the header
 * says what the BROWSER prefers and this says what the person chose in the app.
 * A two-value enum, so it cannot be used to smuggle an instruction into the
 * prompt — see `buildPrompt` in `prompts.ts`, where it selects a branch rather
 * than being interpolated.
 */
export const aiLocaleSchema = z.enum(["en", "ar"]);

export type AiLocale = z.infer<typeof aiLocaleSchema>;

/**
 * The request body, and the whole of what a caller may say.
 *
 * `z.strictObject`, so an unknown key is rejected rather than ignored. There is
 * deliberately NO free-text field anywhere: a caller picks one of four analyses
 * and a language, and everything else the model sees is assembled on the server
 * from the caller's own scoped data. That is what makes prompt injection a
 * non-question here — there is no channel for a caller to write into the
 * prompt at all.
 */
export const aiInsightRequestSchema = z.strictObject({
  analysis: aiAnalysisSchema,
  locale: aiLocaleSchema.default("en"),
});

export type AiInsightRequest = z.infer<typeof aiInsightRequestSchema>;

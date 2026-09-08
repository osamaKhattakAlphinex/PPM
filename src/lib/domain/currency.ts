import { z } from "zod";

/**
 * The currencies a tenant may price in.
 *
 * This lives outside `src/lib/db` on purpose, the same way `auth/roles.ts`
 * does. It is domain vocabulary, not a storage concern: the Organization model
 * needs it, and so does the settings form — and that form is a Client
 * Component. Anything it imports as a VALUE ends up in the browser bundle, so a
 * currency list re-exported from `@/lib/db` would drag Mongoose (and `fs`,
 * `net`, `tls`) into it and fail the build.
 *
 * Pure: zod and nothing else. Safe from a Client Component, a Server Component
 * and the Edge middleware alike.
 *
 * SAR is the product's currency (CLAUDE.md) and the default everywhere. The
 * rest of the GCC is here because the same organization structure is sold
 * across the Gulf; a single-value enum would be a field with nothing to choose.
 */
export const CURRENCIES = ["SAR", "AED", "KWD", "BHD", "OMR", "QAR"] as const;

export type Currency = (typeof CURRENCIES)[number];

export const currencySchema = z.enum(CURRENCIES);

export const DEFAULT_CURRENCY: Currency = "SAR";

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Halalas per riyal. SAR is an ISO 4217 exponent-2 currency.
 *
 * This lives here rather than in `domain/amc.ts` because money is not an AMC
 * concept. `nav/modules.ts` lists `invoicing` as a sibling module for the same
 * roles, and it will need the identical conversion; a helper owned by AMC would
 * force invoicing to either import from AMC — the wrong direction — or restate
 * the rounding rule, and two roundings is one rounding too many.
 *
 * SAR-SPECIFIC, and that is a limitation rather than a fact about `Currency`:
 * KWD, BHD and OMR above are exponent-THREE (1000 fils to the dinar). The moment
 * an amount can be priced in one of them this constant has to become a
 * per-currency lookup and every stored amount has to carry the currency it was
 * stored in. Until then, money in this codebase means halalas.
 */
export const MINOR_UNITS_PER_MAJOR = 100;

/**
 * SAR 1,000,000,000.00, in halalas. The ceiling on any single stored amount.
 *
 * Two jobs. It catches the fat-finger this representation invites — a
 * 20-million-riyal contract typed into the box as halalas is 200 million riyals,
 * and is refused rather than filed — and it keeps every derived figure exact. A
 * Mongoose `Number` path is a BSON double, which represents integers exactly up
 * to 2^53 (~9.0e15); at 1e11 per row that is ninety thousand maximum-value
 * contracts before a `$sum` could lose a halala, which is well past the point
 * where a tenant would have other problems.
 */
export const MAX_MONEY_MINOR_UNITS = 100_000_000_000;

/**
 * A STORED money amount: a non-negative whole number of minor units.
 *
 * Integer, because a decimal riyal amount is a float and floats do not add.
 * `0.1 + 0.2` is `0.30000000000000004`, and a portfolio total a hundredth of a
 * halala out is a total that fails an audit reconciliation for a reason nobody
 * can find. Everything below the API boundary counts halalas.
 *
 * The `.max()` message is written out rather than left to zod. The default is
 * `Too big: expected number to be <=100000000000`, which lands verbatim in
 * `fieldErrors.value` and shows a person a number in a unit they have never
 * heard of.
 */
export const minorUnitsSchema = z.coerce
  .number()
  .int("Amounts are stored in halalas, which are whole numbers")
  .min(0)
  .max(MAX_MONEY_MINOR_UNITS, "That is more than SAR 1,000,000,000.00");

/**
 * At most twelve whole digits and at most two decimal places. Anchored, so
 * nothing with a sign, an exponent or a stray space gets through.
 *
 * Twelve rather than an open `+` so the string cannot be long enough to lose
 * precision in `Number()` before `minorUnitsSchema` gets a chance to reject it
 * for being too large.
 */
const SAR_INPUT_PATTERN = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * What a form actually submits for a money field, converted to minor units.
 *
 * The conversion is INTEGER ARITHMETIC on the two halves of the decimal string,
 * rather than any arithmetic on the decimal itself, and the difference is not
 * academic. `4.35 * 100` is `434.99999999999994`; `1.15 * 100` is
 * `114.99999999999999`; `0.29 * 100` is `28.999999999999996`. These are
 * ordinary amounts somebody types every day, and every one of them TRUNCATES a
 * halala short.
 *
 * `Math.round` rescues those particular three, which is exactly what makes it
 * the dangerous fix: it looks correct on every two-decimal amount anyone tries,
 * and then `1.005 * 100` is `100.49999999999999` and rounds DOWN to 100 — not
 * even the direction the convention would pick. The regex below refuses a third
 * decimal place outright, so that case never arises here; but a conversion whose
 * correctness rests on which way a float happened to land is one nobody can
 * reason about later.
 *
 * Splitting on the point and computing `Number(whole) * 100 + Number(fraction)`
 * cannot be wrong in any of those ways, because neither operand ever leaves the
 * exactly-representable integer range.
 *
 * The regex is therefore load-bearing rather than cosmetic: it is what
 * guarantees there IS a well-formed two-digit fraction to pad, and it runs
 * before anything is multiplied. `1e5`, `-1`, `12.345` and `{ $gt: 0 }` all fail
 * it.
 *
 * A number is accepted as well as a string because a JSON caller will send one;
 * it is stringified and put through the same gate, so `12.345` is refused rather
 * than quietly rounded to `12.35`.
 */
export const sarInputSchema = z
  .union([z.number(), z.string()])
  .transform((value) => (typeof value === "number" ? String(value) : value.trim()))
  .refine((text) => SAR_INPUT_PATTERN.test(text), {
    message: "Enter an amount in riyals, with at most two decimal places",
  })
  .transform((text) => {
    const [whole, fraction = ""] = text.split(".");
    return Number(whole) * MINOR_UNITS_PER_MAJOR + Number(fraction.padEnd(2, "0"));
  })
  /**
   * The same bounds as `minorUnitsSchema`, restated on a PLAIN number rather
   * than piped into it.
   *
   * `minorUnitsSchema` is `z.coerce.number()`, whose zod INPUT type is
   * `unknown` — a coercing schema accepts anything and tries to make a number
   * of it — so it cannot sit on the receiving end of a `.pipe()` that promises
   * to hand it a `number`. It has to stay coerced because it is also the model
   * field, where `zodToSchemaDefinition` reads `min`/`max` off it directly to
   * build the Mongoose path; wrapping it in a pipe would hide those bounds from
   * the derivation and lose `runValidators` enforcement on update.
   *
   * So the bounds appear twice, over one shared pair of constants. The two
   * cannot drift on the numbers, only on the message, and `schemas.test.ts`
   * asserts the boundary from this side.
   */
  .pipe(
    z
      .number()
      .int()
      .min(0)
      .max(MAX_MONEY_MINOR_UNITS, "That is more than SAR 1,000,000,000.00"),
  );

/**
 * Minor units back to major, for DISPLAY ONLY.
 *
 * The result is a float. Never store it, never compare two of them for equality,
 * and never add two together — do all three on the server, in halalas, before
 * calling this. The one caller is the DTO layer, which converts once per row on
 * the way to the browser.
 */
export function halalasToSar(halalas: number): number {
  return halalas / MINOR_UNITS_PER_MAJOR;
}

/**
 * The float-based inverse, for tests and seed data only.
 *
 * Anything taking a value from a person or a request must use `sarInputSchema`
 * instead: this one rounds, and rounding is the failure mode described above.
 */
export function sarToHalalas(sar: number): number {
  return Math.round(sar * MINOR_UNITS_PER_MAJOR);
}

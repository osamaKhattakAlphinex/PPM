/**
 * The published prices.
 *
 * A module of its own because the landing page's JSON-LD quotes the starting
 * price and the pricing page renders the table, and a marketing site whose
 * structured data disagrees with its own page is a site that gets its rich
 * result withdrawn.
 *
 * Prices are whole riyals per month. Not minor units, unlike everything inside
 * the product: these are published list prices in a marketing page, not money
 * anybody is charged through the invoicing module, and the two must not be
 * confused. Nothing downstream adds them.
 */
export interface Plan {
  /** Doubles as the messages key: `marketing.pricing.plans.<key>`. */
  readonly key: "starter" | "growth" | "enterprise";
  /** Whole SAR per month. `null` means "talk to us" — see the enterprise tier. */
  readonly monthly: number | null;
  /** One tier is visually promoted. Exactly one, or the promotion means nothing. */
  readonly featured?: boolean;
  /** How many feature bullets this tier lists. Keys are `feature1`…`featureN`. */
  readonly features: number;
}

export const PLANS: readonly Plan[] = [
  { key: "starter", monthly: 750, features: 4 },
  { key: "growth", monthly: 2400, featured: true, features: 5 },
  { key: "enterprise", monthly: null, features: 5 },
];

/**
 * The figure the landing page's `SoftwareApplication` offer quotes.
 *
 * Derived from `PLANS` rather than restated, so the structured data cannot
 * drift from the table beneath it.
 */
export const STARTING_PRICE_SAR: number = Math.min(
  ...PLANS.filter((plan): plan is Plan & { monthly: number } => plan.monthly !== null).map(
    (plan) => plan.monthly,
  ),
);

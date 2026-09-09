/**
 * Turning a company name into a URL handle.
 *
 * Pure, and separate from the schemas so a test can hold it to the awkward
 * inputs a Gulf market actually produces — Arabic names, "&", double spaces,
 * a trailing "L.L.C." — without booting anything.
 *
 * The organization model demands `^[a-z0-9]+(?:-[a-z0-9]+)*$`, so this function
 * either produces something matching that or produces nothing. Returning null
 * rather than a fallback is deliberate: a company whose name is entirely
 * non-Latin (which is normal here) needs to be ASKED for a handle, not given
 * "org-1" and left to wonder why.
 */

const MAX_SLUG_LENGTH = 64;

export function slugify(value: string): string | null {
  const slug = value
    .normalize("NFKD")
    // Strip combining marks so "Café" becomes "Cafe" rather than losing the e.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Anything that is not a lowercase letter or digit becomes a separator.
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    // The slice can leave a trailing hyphen behind.
    .replace(/-+$/, "");

  return slug.length >= 2 ? slug : null;
}

/**
 * A handle nobody has taken yet.
 *
 * `taken` is asked rather than assumed, so the caller decides what "taken"
 * means — a database read in production, a set in a test. The suffix walk stops
 * rather than looping forever: after a few collisions the honest answer is that
 * this name needs a human decision, not a twelfth numbered variant.
 */
export const MAX_SLUG_ATTEMPTS = 6;

export async function availableSlug(
  base: string,
  taken: (slug: string) => Promise<boolean>,
): Promise<string | null> {
  const root = slugify(base);
  if (!root) return null;

  if (!(await taken(root))) return root;

  for (let attempt = 2; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
    // Trim the root so the suffix cannot push the handle past the model's cap.
    const suffix = `-${attempt}`;
    const candidate = `${root.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!(await taken(candidate))) return candidate;
  }

  return null;
}

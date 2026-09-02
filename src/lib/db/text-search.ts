/**
 * The one way a user-supplied string is allowed to become a query fragment.
 *
 * It lives beside the DAL rather than in a feature module because the reason it
 * is safe is a DAL argument: the result is passed as a TRUSTED `where`
 * fragment, which is the one input to `createRepository` that may carry Mongo
 * operators. Anything that builds such a fragment out of request data has to be
 * auditable in one place, and this is that place.
 */

/** Every character that means something to a regex engine. */
const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\]/g;

/**
 * Escape a term so no character in it can act as a regex operator.
 *
 * Written as a replacer FUNCTION rather than the usual `"\\$&"` replacement
 * string. The two are equivalent to the engine, but the string form depends on
 * a literal double backslash surviving every tool that ever rewrites this file
 * — and it did not: an earlier revision shipped `"$&"`, which replaces each
 * metacharacter with itself and silently reinstates the very ReDoS the escaping
 * exists to prevent. A function cannot degrade that quietly.
 */
function escapeRegex(term: string): string {
  return term.replace(REGEX_METACHARACTERS, (character) => `\\${character}`);
}

/**
 * An anchored, case-insensitive prefix match on a user-supplied term.
 *
 * Three things have to be true before a search term may go near `$regex`, and
 * all three are enforced here rather than trusted to a caller:
 *
 *  - the term is escaped, so no metacharacter survives. An unescaped `(a+)+$`
 *    is a denial of service against our own database.
 *  - it is anchored with `^`, so the query can use the
 *    `{ organizationId, name }` index instead of scanning the collection.
 *  - it is length-capped upstream by `searchTerm` (64 characters).
 *
 * The repository still applies the scope keys after this fragment, and they
 * always win — a prefix filter cannot widen a query beyond the tenant.
 */
export function prefixFilter(field: string, term: string): Record<string, unknown> {
  return { [field]: { $regex: `^${escapeRegex(term)}`, $options: "i" } };
}

/**
 * A MongoDB `$text` search fragment, for terms a prefix match cannot serve.
 *
 * "rooftop chiller" matches nothing as an anchored prefix but is exactly what a
 * word index is for. Requires a text index on the collection — `Asset` declares
 * one as `{ organizationId: 1, name: "text" }`.
 *
 * The term is stripped of the two characters that carry SEARCH SYNTAX rather
 * than search text: a double quote opens a phrase match, and a leading hyphen
 * negates a word. Neither is something a user typing into a filter box means,
 * and a stray one silently returns the wrong set rather than erroring.
 *
 * This is not an injection defence — `$text` takes a string, not a query
 * document, so there is no shape to smuggle. It is about the term meaning what
 * it looks like it means.
 */
export function textSearchFilter(term: string): Record<string, unknown> {
  const cleaned = term.replace(/"/g, " ").replace(/(^|\s)-+/g, "$1").trim();
  return { $text: { $search: cleaned } };
}

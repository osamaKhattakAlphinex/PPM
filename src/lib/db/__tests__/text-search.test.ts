import { describe, expect, it } from "vitest";

import { prefixFilter, textSearchFilter } from "../text-search";

/**
 * The search fragments, tested for the property that actually matters.
 *
 * This file exists because the escaping in `prefixFilter` shipped broken once:
 * a rewrite turned the `"\\$&"` replacement into `"$&"`, which replaces every
 * metacharacter with itself. The function still returned a filter, the search
 * box still worked for ordinary words, and every type check passed — the only
 * symptom was that a hostile term reached the database as a live regex.
 *
 * So the assertions below are about BEHAVIOUR, not shape: the escaped output is
 * compiled and asked whether it still behaves like an operator.
 */

describe("prefixFilter escapes every regex metacharacter", () => {
  it("neutralises a catastrophic-backtracking term", () => {
    const filter = prefixFilter("name", "(a+)+$") as {
      name: { $regex: string; $options: string };
    };

    expect(filter.name.$regex).toBe("^\\(a\\+\\)\\+\\$");

    // The point of the escape: the term is now a literal, so it matches the
    // characters the user typed and cannot act as a quantifier on anything.
    const compiled = new RegExp(filter.name.$regex, "i");
    expect(compiled.test("(a+)+$ pump room")).toBe(true);
    expect(compiled.test("aaaaaaaaaaaaaaaa")).toBe(false);
  });

  it.each([
    [".", "^\\."],
    ["*", "^\\*"],
    ["+", "^\\+"],
    ["?", "^\\?"],
    ["^", "^\\^"],
    ["$", "^\\$"],
    ["{}", "^\\{\\}"],
    ["()", "^\\(\\)"],
    ["|", "^\\|"],
    ["[]", "^\\[\\]"],
    ["\\", "^\\\\"],
  ])("escapes %s", (term, expected) => {
    const filter = prefixFilter("name", term) as { name: { $regex: string } };
    expect(filter.name.$regex).toBe(expected);
    // Whatever it compiled to, it must be a valid regex rather than a throw.
    expect(() => new RegExp(filter.name.$regex)).not.toThrow();
  });

  it("stays anchored, so the query can use the index", () => {
    const filter = prefixFilter("name", "chil") as { name: { $regex: string } };
    expect(filter.name.$regex.startsWith("^")).toBe(true);
    expect(new RegExp(filter.name.$regex, "i").test("Chiller Plant A")).toBe(true);
    // Anchored means a mid-string match does NOT hit.
    expect(new RegExp(filter.name.$regex, "i").test("Rooftop Chiller")).toBe(false);
  });

  it("is case-insensitive and targets the field it was given", () => {
    expect(prefixFilter("type", "ahu")).toEqual({
      type: { $regex: "^ahu", $options: "i" },
    });
  });
});

describe("textSearchFilter", () => {
  it("passes an ordinary multi-word term through", () => {
    expect(textSearchFilter("rooftop chiller")).toEqual({
      $text: { $search: "rooftop chiller" },
    });
  });

  it("strips the characters that carry search SYNTAX rather than text", () => {
    // A quote would open a phrase match, a leading hyphen would negate a word.
    // Neither is what someone typing into a filter box means.
    expect(textSearchFilter('"rooftop" chiller')).toEqual({
      $text: { $search: "rooftop  chiller" },
    });
    expect(textSearchFilter("rooftop -chiller")).toEqual({
      $text: { $search: "rooftop chiller" },
    });
    expect(textSearchFilter("-rooftop")).toEqual({
      $text: { $search: "rooftop" },
    });
  });

  it("does not strip a hyphen inside a word, which is part of an asset name", () => {
    expect(textSearchFilter("ahu-02 rooftop")).toEqual({
      $text: { $search: "ahu-02 rooftop" },
    });
  });
});

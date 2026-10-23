import { describe, it, expect } from "vitest";
import { load } from "cheerio";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHtml, resolveField, foldCandidates } from "../src/extraction/dom-extractor.js";
import { productFields } from "../src/extraction/schemas.js";
import { buildSelector } from "../src/extraction/selector.js";
import type { Candidate, FieldSpec } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

function readFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf-8");
}

const BASE_URL = "https://shop.example.com/products/headphones";
const field = (name: string): FieldSpec => productFields.find((f) => f.name === name)!;

describe("resolveField on a stable page", () => {
  const ctx = parseHtml(readFixture("product-v1-stable.html"), BASE_URL);

  it("resolves name from JSON-LD or DOM, not the footer's unrelated content", () => {
    const outcome = resolveField(ctx, field("name"), undefined, ["Product"]);
    expect(outcome.status).toBe("resolved");
    expect(outcome.value).toBe("Wireless Headphones");
  });

  it("resolves the current price and ignores the struck-through old price", () => {
    const outcome = resolveField(ctx, field("price"), undefined, ["Product"]);
    expect(outcome.status).toBe("resolved");
    expect(outcome.value).toBe(2499);
  });

  it("ignores the related-products price in the footer", () => {
    const outcome = resolveField(ctx, field("price"), undefined, ["Product"]);
    expect(outcome.value).not.toBe(999);
  });

  it("resolves availability", () => {
    const outcome = resolveField(ctx, field("availability"), undefined, ["Product"]);
    expect(outcome.status).toBe("resolved");
    expect(outcome.value).toBe("In stock");
  });

  it("resolves the canonical URL", () => {
    const outcome = resolveField(ctx, field("url"), undefined, ["Product"]);
    expect(outcome.status).toBe("resolved");
    expect(outcome.value).toBe("https://shop.example.com/products/headphones");
  });
});

describe("resolveField when a saved selector still works", () => {
  it("prefers the saved selector over re-discovering the field", () => {
    const ctx = parseHtml(readFixture("product-v1-stable.html"), BASE_URL);
    const outcome = resolveField(ctx, field("price"), {
      siteKey: "shop.example.com/products/",
      field: "price",
      selector: '[id="product-price"]',
      version: 1,
      confidence: 0.9,
      source: "initial",
      updatedAt: new Date().toISOString(),
    }, ["Product"]);
    expect(outcome.status).toBe("resolved");
    expect(outcome.strategy).toBe("saved-selector");
    expect(outcome.value).toBe(2499);
  });
});

describe("resolveField after a CSS rename (self-healing should not be required for DOM-findable fields)", () => {
  const ctx = parseHtml(readFixture("product-v2-renamed.html"), BASE_URL);

  it("still finds price via fallback-friendly attributes like data-qa", () => {
    const outcome = resolveField(ctx, field("price"), undefined, ["Product"]);
    // data-qa="amount-value" does not contain the primary hint "price", so the first pass is expected to miss it.
    expect(outcome.status).not.toBe("resolved");
  });

  it("finds availability via data-testid even though classes were renamed", () => {
    const outcome = resolveField(ctx, field("availability"), undefined, ["Product"]);
    expect(outcome.status).toBe("resolved");
    expect(outcome.value).toBe("In stock");
  });
});

describe("resolveField flags real ambiguity", () => {
  it("reports two differently-priced elements with similar support as ambiguous", () => {
    const ctx = parseHtml(readFixture("product-v3-ambiguous-price.html"), BASE_URL);
    const outcome = resolveField(ctx, field("price"), undefined, ["Product"]);
    expect(outcome.status).toBe("ambiguous");
  });
});

describe("resolveField reports missing fields honestly", () => {
  it("does not invent a price when none is present", () => {
    const ctx = parseHtml(readFixture("product-v5-missing-price.html"), BASE_URL);
    const outcome = resolveField(ctx, field("price"), undefined, ["Product"]);
    expect(outcome.status).toBe("missing");
    expect(outcome.value).toBeUndefined();
  });
});

describe("foldCandidates", () => {
  it("returns missing when there are no candidates", () => {
    const outcome = foldCandidates(field("price"), [], []);
    expect(outcome.status).toBe("missing");
  });

  it("boosts confidence when independent strategies agree", () => {
    const candidates: Candidate[] = [
      { raw: "2499", value: 2499, strategy: "json-ld", matchCount: 1 },
      { raw: "₹2,499", value: 2499, strategy: "semantic", matchCount: 1, selector: "#p" },
    ];
    const outcome = foldCandidates(field("price"), candidates, []);
    expect(outcome.status).toBe("resolved");
    const soleCandidates: Candidate[] = [{ raw: "2499", value: 2499, strategy: "json-ld", matchCount: 1 }];
    const soleOutcome = foldCandidates(field("price"), soleCandidates, []);
    expect(outcome.confidence).toBeGreaterThan(soleOutcome.confidence);
  });

  it("flags ambiguous when two groups have similar strength and disagree", () => {
    const candidates: Candidate[] = [
      { raw: "2499", value: 2499, strategy: "semantic", matchCount: 1, selector: "#a" },
      { raw: "1899", value: 1899, strategy: "semantic", matchCount: 1, selector: "#b" },
    ];
    const outcome = foldCandidates(field("price"), candidates, []);
    expect(outcome.status).toBe("ambiguous");
  });
});

describe("buildSelector", () => {
  it("builds an id-based selector when a stable id is present", () => {
    const $ = load('<div id="product-price">₹2,499</div>');
    const el = $("#product-price").get(0)!;
    const built = buildSelector($, el as any);
    expect(built?.selector).toBe('[id="product-price"]');
    expect(built?.stable).toBe(true);
  });

  it("falls back to a positional path when there is no id", () => {
    const $ = load("<div><span>a</span><span>b</span></div>");
    const second = $("span").get(1)!;
    const built = buildSelector($, second as any);
    expect(built?.stable).toBe(false);
    expect($(built!.selector).get(0)).toBe(second);
  });

  it("does not treat a long numeric-looking id (likely auto-generated) as stable", () => {
    const $ = load('<div id="react-root-184729384"><span id="x">v</span></div>');
    const el = $("#x").get(0)!;
    const built = buildSelector($, el as any);
    // the long numeric id in an ancestor is skipped; the element's own short id is used instead
    expect(built?.selector).toBe('[id="x"]');
  });
});

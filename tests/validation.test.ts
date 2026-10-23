import { describe, it, expect } from "vitest";
import { parsePrice, parseAvailability, parseUrl, parseText, hasCurrencyMarker } from "../src/extraction/parsers.js";
import { ProductSchema } from "../src/extraction/schemas.js";
import { valuesAgree, distinctBy } from "../src/extraction/compare.js";

describe("parsePrice", () => {
  it("parses a rupee amount with a thousands separator", () => {
    expect(parsePrice("₹2,499.00")).toBe(2499);
  });
  it("parses a plain dollar amount", () => {
    expect(parsePrice("$1,299")).toBe(1299);
  });
  it("parses European-style decimal comma", () => {
    expect(parsePrice("1.299,50 €")).toBeCloseTo(1299.5);
  });
  it("parses Indian lakh-style grouping", () => {
    expect(parsePrice("Rs. 1,23,456")).toBe(123456);
  });
  it("rejects text with a percent sign", () => {
    expect(parsePrice("50% off")).toBeNull();
  });
  it("rejects text with two numbers", () => {
    expect(parsePrice("2 for 499")).toBeNull();
  });
  it("rejects empty text", () => {
    expect(parsePrice("   ")).toBeNull();
  });
  it("rejects negative-looking garbage", () => {
    expect(parsePrice("n/a")).toBeNull();
  });
});

describe("hasCurrencyMarker", () => {
  it("detects common currency symbols and codes", () => {
    expect(hasCurrencyMarker("₹499")).toBe(true);
    expect(hasCurrencyMarker("USD 10")).toBe(true);
    expect(hasCurrencyMarker("hello world")).toBe(false);
  });
});

describe("parseAvailability", () => {
  it("recognizes in-stock phrasing", () => {
    expect(parseAvailability("In Stock")).toBe("In stock");
    expect(parseAvailability("Available now")).toBe("In stock");
  });
  it("recognizes out-of-stock phrasing", () => {
    expect(parseAvailability("Out of Stock")).toBe("Out of stock");
    expect(parseAvailability("Currently unavailable")).toBe("Out of stock");
  });
  it("returns null for unrecognized text", () => {
    expect(parseAvailability("Ships in 3 days")).toBeNull();
  });
  it("returns null for suspiciously long text (not a status label)", () => {
    expect(parseAvailability("x".repeat(100))).toBeNull();
  });
});

describe("parseUrl", () => {
  it("accepts an absolute https URL", () => {
    expect(parseUrl("https://example.com/p/1")).toBe("https://example.com/p/1");
  });
  it("resolves a relative URL against a base", () => {
    expect(parseUrl("/p/1", "https://example.com/x")).toBe("https://example.com/p/1");
  });
  it("rejects a javascript: URL", () => {
    expect(parseUrl("javascript:alert(1)")).toBeNull();
  });
  it("rejects garbage", () => {
    expect(parseUrl("not a url")).toBeNull();
  });
});

describe("parseText", () => {
  it("trims and accepts normal text", () => {
    expect(parseText("  Wireless Headphones  ")).toBe("Wireless Headphones");
  });
  it("rejects empty text", () => {
    expect(parseText("   ")).toBeNull();
  });
});

describe("ProductSchema", () => {
  it("accepts a valid product object", () => {
    const result = ProductSchema.safeParse({
      name: "Wireless Headphones",
      price: 2499,
      availability: "In stock",
      url: "https://example.com/products/headphones",
    });
    expect(result.success).toBe(true);
  });
  it("rejects a negative price", () => {
    const result = ProductSchema.safeParse({
      name: "x",
      price: -1,
      availability: "In stock",
      url: "https://example.com/x",
    });
    expect(result.success).toBe(false);
  });
  it("rejects an invalid availability enum value", () => {
    const result = ProductSchema.safeParse({
      name: "x",
      price: 1,
      availability: "Maybe",
      url: "https://example.com/x",
    });
    expect(result.success).toBe(false);
  });
});

describe("valuesAgree / distinctBy", () => {
  it("treats close enough prices as equal and different prices as different", () => {
    expect(valuesAgree("price", 2499, 2499.0)).toBe(true);
    expect(valuesAgree("price", 2499, 1899)).toBe(false);
  });
  it("normalizes URLs with trailing slashes and different casing of host", () => {
    expect(valuesAgree("url", "https://Example.com/p/1/", "https://example.com/p/1")).toBe(true);
  });
  it("collapses near-duplicate text", () => {
    expect(valuesAgree("text", "Wireless Headphones", "wireless headphones")).toBe(true);
  });
  it("dedupes a list of candidates down to distinct values", () => {
    const items = [{ value: 2499 }, { value: 2499.0 }, { value: 1899 }];
    expect(distinctBy("price", items)).toHaveLength(2);
  });
});

import type { FieldKind, FieldValue } from "../types.js";

export const AVAILABILITY_VALUES = ["In stock", "Out of stock", "Unknown"] as const;
export type Availability = (typeof AVAILABILITY_VALUES)[number];

export function normalizeText(input: string): string {
  return input.replace(/[\s\u00a0\u200b]+/g, " ").trim();
}

const CURRENCY_MARKER = /[₹$€£¥]|\b(?:rs\.?|inr|usd|eur|gbp|aud|cad|jpy)\b/i;

export function hasCurrencyMarker(text: string): boolean {
  return CURRENCY_MARKER.test(text);
}

/**
 * Turns text such as "₹2,499.00", "$1,299", "1.299,50 €" or "Rs. 1,23,456" into a number.
 * Returns null when the text has no number, more than one number, a percent sign, or an unclear format.
 * Returning null is deliberate: an unclear price must never become a guessed price.
 */
export function parsePrice(input: string): number | null {
  const text = normalizeText(input);
  if (!text || text.includes("%")) return null;
  if (text.startsWith("-") || text.startsWith("+")) return null;

  const tokens = text.match(/\d[\d.,]*/g);
  if (!tokens || tokens.length !== 1) return null;

  const rawToken = tokens[0]!;
  const token = rawToken.replace(/[.,]+$/, "");
  const remainder = text.replace(rawToken, "").replace(/[₹$€£¥.,:\-/\s]/g, "");
  if (remainder.length > 30) return null;

  const hasComma = token.includes(",");
  const hasDot = token.includes(".");
  let normalized: string;

  if (hasComma && hasDot) {
    normalized =
      token.lastIndexOf(".") > token.lastIndexOf(",")
        ? token.replace(/,/g, "")
        : token.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    if (/^\d{1,3}(,\d{2,3})+$/.test(token)) normalized = token.replace(/,/g, "");
    else if (/^\d+,\d{1,2}$/.test(token)) normalized = token.replace(",", ".");
    else return null;
  } else if (hasDot) {
    if (/^\d{1,3}(\.\d{3}){2,}$/.test(token)) normalized = token.replace(/\./g, "");
    else if (/^\d+\.\d+$/.test(token)) normalized = token;
    else return null;
  } else {
    normalized = token;
  }

  const value = Number(normalized);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

const OUT_OF_STOCK = ["outofstock", "soldout", "unavailable", "notavailable", "discontinued", "currentlyunavailable"];
const IN_STOCK = ["instock", "available", "limitedavailability", "readytoship"];

export function parseAvailability(input: string): Availability | null {
  const text = normalizeText(input);
  if (!text || text.length > 80) return null;
  const compact = text.toLowerCase().replace(/[^a-z]/g, "");
  if (OUT_OF_STOCK.some((word) => compact.includes(word))) return "Out of stock";
  if (IN_STOCK.some((word) => compact.includes(word))) return "In stock";
  return null;
}

export function parseUrl(input: string, base?: string): string | null {
  const text = normalizeText(input);
  if (!text || text.length > 2048) return null;
  try {
    const url = new URL(text, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function parseText(input: string): string | null {
  const text = normalizeText(input);
  return text.length >= 1 && text.length <= 500 ? text : null;
}

export function parseValue(kind: FieldKind, raw: string, baseUrl?: string): FieldValue | null {
  switch (kind) {
    case "price":
      return parsePrice(raw);
    case "availability":
      return parseAvailability(raw);
    case "url":
      return parseUrl(raw, baseUrl);
    case "text":
      return parseText(raw);
  }
}

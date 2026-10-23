import type { FieldKind, FieldValue } from "../types.js";
import { normalizeText } from "./parsers.js";

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hostname = url.hostname.toLowerCase();
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.href;
  } catch {
    return value.trim().toLowerCase();
  }
}

/** Decides whether two parsed values mean the same thing for a field kind. */
export function valuesAgree(kind: FieldKind, a: FieldValue, b: FieldValue): boolean {
  switch (kind) {
    case "price":
      return Math.abs(Number(a) - Number(b)) < 0.005;
    case "availability":
      return String(a) === String(b);
    case "url":
      return normalizeUrl(String(a)) === normalizeUrl(String(b));
    case "text": {
      const left = normalizeText(String(a)).toLowerCase();
      const right = normalizeText(String(b)).toLowerCase();
      if (left === right) return true;
      if (Math.min(left.length, right.length) < 3) return false;
      return left.includes(right) || right.includes(left);
    }
  }
}

/** Keeps the first item of every group of values that agree with each other. */
export function distinctBy<T extends { value: FieldValue }>(kind: FieldKind, items: T[]): T[] {
  const out: T[] = [];
  for (const item of items) {
    if (!out.some((kept) => valuesAgree(kind, kept.value, item.value))) out.push(item);
  }
  return out;
}

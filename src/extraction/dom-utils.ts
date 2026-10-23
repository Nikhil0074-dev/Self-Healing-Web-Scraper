import type { CheerioAPI } from "cheerio";
import { isTag, type Element } from "domhandler";
import type { FieldSpec } from "../types.js";
import { normalizeText } from "./parsers.js";

const NOISE_RE =
  /(related|recommend|similar|carousel|upsell|cross-?sell|also-?(?:bought|viewed)|recently|sponsored|advert|breadcrumb|newsletter)/i;
const SECONDARY_RE =
  /(?<![a-z])(?:old|was|original|strike|struck|strikethrough|compare|regular|before|saving|savings|discount|mrp|msrp|crossed|retail|previous|slashed|list-?price|oldprice)(?![a-z])/i;

export function escapeAttr(value: string): string {
  return value.replace(/(["\\])/g, "\\$1");
}

export function isIgnored($: CheerioAPI, el: Element): boolean {
  return $(el).closest("script,style,noscript,template,head,svg").length > 0;
}

/** Elements inside footers, navigation, "related products" blocks and similar areas are not the main product. */
export function isNoise($: CheerioAPI, el: Element): boolean {
  let node = el.parent;
  while (node && isTag(node)) {
    if (["footer", "nav", "aside"].includes(node.name)) return true;
    if (NOISE_RE.test(`${node.attribs["class"] ?? ""} ${node.attribs["id"] ?? ""}`)) return true;
    node = node.parent;
  }
  return false;
}

/** True for struck-through, "old", "was" or "discount" prices. */
export function isSecondaryPrice($: CheerioAPI, el: Element): boolean {
  if ($(el).closest("del,s,strike").length > 0) return true;
  let node: Element | null = el;
  for (let depth = 0; depth < 3 && node && isTag(node); depth += 1) {
    const marker = `${node.attribs["class"] ?? ""} ${node.attribs["id"] ?? ""}`;
    if (SECONDARY_RE.test(marker)) return true;
    if (/line-through/i.test(node.attribs["style"] ?? "")) return true;
    node = node.parent && isTag(node.parent) ? node.parent : null;
  }
  return false;
}

export function defaultAttrFor(field: FieldSpec, el: Element): string | undefined {
  if (field.attr) return field.attr;
  if (field.kind === "url" && (el.name === "a" || el.name === "link")) return "href";
  return undefined;
}

export function readRaw($: CheerioAPI, el: Element, attr?: string): string {
  const $el = $(el);
  if (attr) return normalizeText($el.attr(attr) ?? "");
  if (el.name === "meta") return normalizeText($el.attr("content") ?? "");
  const text = normalizeText($el.text());
  return text || normalizeText($el.attr("content") ?? "");
}

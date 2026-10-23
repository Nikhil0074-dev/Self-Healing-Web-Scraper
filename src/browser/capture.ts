import type { Page } from "playwright";
import type { ElementBox } from "../types.js";

export async function captureHtml(page: Page): Promise<string> {
  return page.content();
}

export async function captureScreenshot(page: Page): Promise<Buffer> {
  return page.screenshot({ type: "png", fullPage: false });
}

/**
 * Returns the bounding box of every element whose text or attributes mention a hint word.
 * Used to let the vision model refer to elements by number instead of guessing coordinates.
 */
export async function captureCandidateBoxes(
  page: Page,
  hints: string[],
  options: { includeCurrencyText?: boolean } = {}
): Promise<ElementBox[]> {
  return page.evaluate(
    ({ hintWords, includeCurrencyText }: { hintWords: string[]; includeCurrencyText: boolean }) => {
    const results: ElementBox[] = [];
    const all = Array.from(document.querySelectorAll<HTMLElement>("body *"));
    const currencyRe = /[₹$€£¥]\s?\d|\b\d[\d,.]*\s?(?:rs|inr|usd|eur)\b/i;
    let idx = 0;
    for (const el of all) {
      const text = (el.textContent ?? "").trim();
      if (!text || text.length > 120) continue;
      const hasOwnText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0);
      const haystack = `${el.id} ${el.className} ${text}`.toLowerCase();
      const hintMatch = hintWords.some((h) => haystack.includes(h.toLowerCase()));
      const currencyMatch = includeCurrencyText && hasOwnText && currencyRe.test(text);
      if (!hintMatch && !currencyMatch) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (rect.top < 0 || rect.top > window.innerHeight) continue;
      results.push({
        idx: idx++,
        tag: el.tagName.toLowerCase(),
        text: text.slice(0, 80),
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
      if (results.length >= 40) break;
    }
    return results;
    },
    { hintWords: hints, includeCurrencyText: options.includeCurrencyText ?? false }
  );
}

export interface PointSelector {
  selector: string | null;
  stable: boolean;
  tag: string;
  attr?: string;
  text: string;
}

/**
 * Finds the DOM element at a pixel position (as reported by the vision model) and builds a
 * CSS selector for it directly in the browser, the same way extraction/selector.ts does for cheerio.
 */
export async function locateElementAt(page: Page, x: number, y: number): Promise<PointSelector | null> {
  return page.evaluate(({ px, py }) => {
    function escapeAttr(v: string): string {
      return v.replace(/(["\\])/g, "\\$1");
    }
    const start = document.elementFromPoint(px, py) as HTMLElement | null;
    if (!start) return null;

    let node: HTMLElement | null = start;
    const parts: string[] = [];
    let stable = false;

    while (node && node.nodeType === 1) {
      const id = node.id;
      if (id && id.length <= 40 && !/\d{4,}/.test(id) && document.querySelectorAll(`[id="${escapeAttr(id)}"]`).length === 1) {
        parts.unshift(`[id="${escapeAttr(id)}"]`);
        stable = true;
        break;
      }
      let anchored = false;
      for (const attr of ["data-testid", "data-test", "itemprop"]) {
        const value = node.getAttribute(attr);
        if (value && document.querySelectorAll(`[${attr}="${escapeAttr(value)}"]`).length === 1) {
          parts.unshift(`${node.tagName.toLowerCase()}[${attr}="${escapeAttr(value)}"]`);
          stable = true;
          anchored = true;
          break;
        }
      }
      if (anchored) break;

      const parent: HTMLElement | null = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
        const position = siblings.indexOf(node) + 1;
        parts.unshift(siblings.length > 1 ? `${node.tagName.toLowerCase()}:nth-of-type(${position})` : node.tagName.toLowerCase());
      } else {
        parts.unshift(node.tagName.toLowerCase());
      }
      if (node.tagName.toLowerCase() === "html") break;
      node = parent;
    }

    const selector = parts.join(" > ");
    let matchCount = 0;
    try {
      matchCount = document.querySelectorAll(selector).length;
    } catch {
      return { selector: null, stable: false, tag: start.tagName.toLowerCase(), text: (start.textContent ?? "").slice(0, 120) };
    }
    return {
      selector: matchCount === 1 ? selector : null,
      stable,
      tag: start.tagName.toLowerCase(),
      text: (start.textContent ?? "").trim().slice(0, 120),
    };
  }, { px: x, py: y });
}

import { isTag } from "domhandler";
import { foldCandidates } from "../extraction/dom-extractor.js";
import { buildSelector } from "../extraction/selector.js";
import { isIgnored, defaultAttrFor, readRaw } from "../extraction/dom-utils.js";
import { parseValue, hasCurrencyMarker } from "../extraction/parsers.js";
/** Extra synonyms tried only during repair, once the normal hint list has already failed. */
const FALLBACK_HINTS = {
    price: ["price", "amount", "cost", "value", "sale", "now", "current"],
    availability: ["stock", "availability", "status", "inventory"],
    url: ["canonical", "permalink", "share"],
    text: [],
};
/**
 * Broadens the search: ignores the "related products / noise" filter (in case it hid the real
 * element), accepts secondary/struck-through prices as a last resort, and tries fallback hint words.
 * Every candidate this produces is tagged "dom-repair" and given a visibly lower confidence than a
 * normal first-pass match, so it never silently outranks a real find.
 */
export function attemptDomRepair(ctx, field, diagnosis) {
    const { $, pageUrl } = ctx;
    const hints = Array.from(new Set([...field.hints, ...(FALLBACK_HINTS[field.kind] ?? [])]));
    const candidates = [];
    const seen = new Set();
    $("body *").each((_i, el) => {
        if (!isTag(el) || isIgnored($, el) || seen.has(el))
            return;
        const haystack = ["id", "class", "data-testid", "data-test", "itemprop", "name"]
            .map((a) => el.attribs[a] ?? "")
            .join(" ")
            .toLowerCase();
        if (!hints.some((h) => haystack.includes(h.toLowerCase())))
            return;
        const hasDeeperMatch = $(el)
            .find("*")
            .toArray()
            .some((child) => {
            if (!isTag(child))
                return false;
            const childHaystack = ["id", "class", "data-testid"].map((a) => child.attribs[a] ?? "").join(" ").toLowerCase();
            return hints.some((h) => childHaystack.includes(h.toLowerCase()));
        });
        if (hasDeeperMatch)
            return;
        seen.add(el);
        const attr = defaultAttrFor(field, el);
        const raw = readRaw($, el, attr);
        if (!raw)
            return;
        if (field.kind === "price" && !hasCurrencyMarker(raw) && !/\d/.test(raw))
            return;
        const value = parseValue(field.kind, raw, pageUrl);
        if (value === null)
            return;
        const built = buildSelector($, el);
        candidates.push({
            raw,
            value,
            strategy: "dom-repair",
            selector: built?.selector,
            attr,
            matchCount: 1,
            stable: built?.stable,
        });
    });
    return foldCandidates(field, candidates, [`DOM repair ran because: ${diagnosis.detail}`]);
}
//# sourceMappingURL=locator-repair.js.map
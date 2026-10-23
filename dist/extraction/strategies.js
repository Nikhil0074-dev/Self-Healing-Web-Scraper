import { isTag } from "domhandler";
import { isIgnored, isNoise, isSecondaryPrice, defaultAttrFor, readRaw, escapeAttr } from "./dom-utils.js";
import { parseValue, hasCurrencyMarker, normalizeText } from "./parsers.js";
import { collectJsonLdNodes, readPath } from "./jsonld.js";
import { buildSelector } from "./selector.js";
function toCandidate(field, raw, strategy, baseUrl, opts = {}) {
    const value = parseValue(field.kind, raw, baseUrl);
    if (value === null)
        return null;
    return {
        raw,
        value,
        strategy,
        selector: opts.selector,
        attr: opts.attr,
        matchCount: opts.matchCount ?? 1,
        stable: opts.stable,
    };
}
/** Runs a specific CSS selector (saved rule or user-provided seed). Reports how many elements matched. */
export function fromSelector($, field, selector, attr, strategy, baseUrl) {
    let elements;
    try {
        elements = $(selector).toArray().filter((el) => isTag(el) && !isIgnored($, el));
    }
    catch {
        return [];
    }
    if (elements.length === 0)
        return [];
    const resolvedAttr = attr ?? defaultAttrFor(field, elements[0]);
    return elements
        .map((el) => toCandidate(field, readRaw($, el, resolvedAttr), strategy, baseUrl, {
        selector,
        attr: resolvedAttr,
        matchCount: elements.length,
    }))
        .filter((c) => c !== null);
}
/** Reads the field from JSON-LD Product/Offer nodes. This is the most reliable source when present. */
export function fromJsonLd($, field, types, baseUrl) {
    if (!field.jsonld?.length)
        return [];
    const nodes = collectJsonLdNodes($, types);
    const out = [];
    for (const node of nodes) {
        for (const path of field.jsonld) {
            const value = readPath(node, path);
            if (value === undefined || value === null)
                continue;
            const candidate = toCandidate(field, String(value), "json-ld", baseUrl, { matchCount: 1 });
            if (candidate)
                out.push(candidate);
        }
    }
    return out;
}
/** Reads <meta> tags and <link rel="canonical">. */
export function fromMetadata($, field, baseUrl) {
    if (!field.meta?.length)
        return [];
    const out = [];
    for (const name of field.meta) {
        if (name === "canonical") {
            const href = $('link[rel="canonical"]').first().attr("href");
            if (href) {
                const candidate = toCandidate(field, href, "metadata", baseUrl, { selector: 'link[rel="canonical"]', attr: "href" });
                if (candidate)
                    out.push(candidate);
            }
            continue;
        }
        const el = $(`meta[property="${escapeAttr(name)}"], meta[name="${escapeAttr(name)}"], [itemprop="${escapeAttr(name)}"]`).first();
        if (el.length) {
            const content = el.attr("content");
            const raw = content ?? el.text();
            if (raw) {
                const attr = content !== undefined ? "content" : undefined;
                const candidate = toCandidate(field, raw, "metadata", baseUrl, { attr });
                if (candidate)
                    out.push(candidate);
            }
        }
    }
    return out;
}
const PRICE_LIKE_ATTRS = ["id", "class", "data-testid", "data-test", "itemprop", "data-field", "data-qa"];
/** Searches for elements whose id/class/data-* attributes contain one of the field's hint words. */
export function fromSemantic($, field, baseUrl) {
    if (!field.hints.length)
        return [];
    const out = [];
    const seen = new Set();
    $("body *").each((_i, el) => {
        if (!isTag(el) || isIgnored($, el) || isNoise($, el) || seen.has(el))
            return;
        const haystack = PRICE_LIKE_ATTRS.map((a) => el.attribs[a] ?? "").join(" ").toLowerCase();
        if (!haystack.trim())
            return;
        const matchesHint = field.hints.some((hint) => haystack.includes(hint.toLowerCase()));
        if (!matchesHint)
            return;
        // Prefer the smallest matching element: skip if a matching descendant exists.
        const hasDeeperMatch = $(el)
            .find("*")
            .toArray()
            .some((child) => {
            if (!isTag(child))
                return false;
            const childHaystack = PRICE_LIKE_ATTRS.map((a) => child.attribs[a] ?? "").join(" ").toLowerCase();
            return field.hints.some((hint) => childHaystack.includes(hint.toLowerCase()));
        });
        if (hasDeeperMatch)
            return;
        if (field.kind === "price" && isSecondaryPrice($, el))
            return;
        seen.add(el);
        const attr = defaultAttrFor(field, el);
        const raw = readRaw($, el, attr);
        if (!raw)
            return;
        if (field.kind === "price" && !hasCurrencyMarker(raw) && !/\d/.test(raw))
            return;
        const built = buildSelector($, el);
        const candidate = toCandidate(field, raw, "semantic", baseUrl, {
            selector: built?.selector,
            attr,
            stable: built?.stable,
        });
        if (candidate)
            out.push(candidate);
    });
    return out;
}
/** Finds "Label: value" or "<dt>Label</dt><dd>value</dd>" style layouts using the field's label words. */
export function fromLabel($, field, baseUrl) {
    if (!field.labels?.length)
        return [];
    const out = [];
    const labelRe = new RegExp(`^(?:${field.labels.map((l) => l.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*:?\\s*$`, "i");
    $("dt, th, label, span, div, strong, b").each((_i, el) => {
        if (!isTag(el) || isIgnored($, el) || isNoise($, el))
            return;
        const labelText = normalizeText($(el).text());
        if (!labelRe.test(labelText) || labelText.length > 40)
            return;
        let valueEl = null;
        if (el.name === "dt")
            valueEl = $(el).next("dd").get(0) ?? null;
        else if (el.name === "th")
            valueEl = $(el).closest("tr").find("td").first().get(0) ?? null;
        else
            valueEl = $(el).next().get(0) ?? null;
        if (!valueEl) {
            // "Label: value" in the same element's trailing text.
            const parentText = el.parent ? normalizeText($(el.parent).text()) : "";
            const stripped = parentText.replace(new RegExp(labelText, "i"), "").trim();
            if (stripped && stripped !== parentText) {
                const candidate = toCandidate(field, stripped, "label", baseUrl, { matchCount: 1 });
                if (candidate)
                    out.push(candidate);
            }
            return;
        }
        const raw = readRaw($, valueEl, defaultAttrFor(field, valueEl));
        const built = buildSelector($, valueEl);
        const candidate = toCandidate(field, raw, "label", baseUrl, { selector: built?.selector, stable: built?.stable });
        if (candidate)
            out.push(candidate);
    });
    return out;
}
/** For url-kind fields: falls back to the page's own address when nothing more specific was found. */
export function fromPageUrl(field, pageUrl) {
    if (field.kind !== "url")
        return [];
    const candidate = toCandidate(field, pageUrl, "page-url", pageUrl, { matchCount: 1 });
    return candidate ? [candidate] : [];
}
//# sourceMappingURL=strategies.js.map
/** Reads a dotted path like "offers.price" out of a nested object. Arrays take their first element. */
export function readPath(obj, path) {
    let current = obj;
    for (const key of path.split(".")) {
        if (Array.isArray(current))
            current = current[0];
        if (current && typeof current === "object" && key in current) {
            current = current[key];
        }
        else {
            return undefined;
        }
    }
    if (Array.isArray(current))
        current = current[0];
    return current;
}
function flattenGraph(node) {
    if (!node || typeof node !== "object")
        return [];
    const obj = node;
    if (Array.isArray(obj["@graph"]))
        return obj["@graph"].flatMap(flattenGraph);
    return [obj];
}
/** Collects every JSON-LD node on the page whose @type matches one of `types` (case-insensitive, substring match). */
export function collectJsonLdNodes($, types) {
    const nodes = [];
    $('script[type="application/ld+json"]').each((_i, el) => {
        const raw = $(el).contents().text();
        if (!raw || raw.length > 200_000)
            return;
        try {
            const parsed = JSON.parse(raw);
            const list = Array.isArray(parsed) ? parsed.flatMap(flattenGraph) : flattenGraph(parsed);
            for (const item of list) {
                if (!item || typeof item !== "object")
                    continue;
                const typeValue = item["@type"];
                const typeStrings = (Array.isArray(typeValue) ? typeValue : [typeValue]).filter((t) => typeof t === "string");
                if (typeStrings.some((t) => types.some((want) => t.toLowerCase().includes(want.toLowerCase())))) {
                    nodes.push(item);
                }
            }
        }
        catch {
            // Malformed JSON-LD on the page is common and not a scraper bug; skip it.
        }
    });
    return nodes;
}
//# sourceMappingURL=jsonld.js.map
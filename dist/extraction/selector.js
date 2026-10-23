import { isTag } from "domhandler";
import { escapeAttr } from "./dom-utils.js";
function isStableId(id) {
    return id.length <= 40 && !/\d{4,}/.test(id) && !/^[a-f0-9]{8,}$/i.test(id);
}
/**
 * Builds a CSS selector that matches exactly this element.
 * Classes are not used because they are the part of a page that changes most often.
 * Returns null if no unique selector could be built.
 */
export function buildSelector($, target) {
    const parts = [];
    let stable = false;
    let node = target;
    while (node && isTag(node)) {
        const id = node.attribs["id"];
        if (id && isStableId(id) && $(`[id="${escapeAttr(id)}"]`).length === 1) {
            parts.unshift(`[id="${escapeAttr(id)}"]`);
            stable = true;
            break;
        }
        let anchored = false;
        for (const attr of ["data-testid", "data-test", "itemprop"]) {
            const value = node.attribs[attr];
            if (value && $(`[${attr}="${escapeAttr(value)}"]`).length === 1) {
                parts.unshift(`${node.name}[${attr}="${escapeAttr(value)}"]`);
                stable = true;
                anchored = true;
                break;
            }
        }
        if (anchored)
            break;
        const siblings = node.parent
            ? node.parent.children.filter((child) => isTag(child) && child.name === node.name)
            : [];
        const position = siblings.indexOf(node) + 1;
        parts.unshift(siblings.length > 1 ? `${node.name}:nth-of-type(${position})` : node.name);
        if (node.name === "html")
            break;
        node = node.parent && isTag(node.parent) ? node.parent : null;
    }
    const selector = parts.join(" > ");
    try {
        const matches = $(selector).toArray();
        if (matches.length !== 1 || matches[0] !== target)
            return null;
    }
    catch {
        return null;
    }
    return { selector, stable };
}
//# sourceMappingURL=selector.js.map
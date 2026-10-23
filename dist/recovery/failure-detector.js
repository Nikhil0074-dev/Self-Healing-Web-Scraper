import { diagnose } from "../extraction/dom-extractor.js";
const MAX_PLAUSIBLE_PRICE = 50_000_000;
/**
 * Looks at a resolved-but-suspicious outcome and flags it for recovery anyway.
 * A resolved status is not automatically trustworthy: a price of 0 or an absurdly large number
 * usually means the wrong element was matched.
 */
export function checkPlausibility(field, outcome) {
    if (outcome.status !== "resolved" || outcome.value === undefined)
        return null;
    if (field.kind === "price") {
        const price = Number(outcome.value);
        if (price === 0) {
            return { field: field.name, reason: "implausible", detail: "Price resolved to zero.", candidates: outcome.candidates };
        }
        if (price > MAX_PLAUSIBLE_PRICE) {
            return {
                field: field.name,
                reason: "implausible",
                detail: `Price ${price} is implausibly large.`,
                candidates: outcome.candidates,
            };
        }
    }
    if (outcome.confidence < 0.55) {
        return {
            field: field.name,
            reason: "implausible",
            detail: `Confidence ${outcome.confidence.toFixed(2)} is below the trust threshold.`,
            candidates: outcome.candidates,
        };
    }
    return null;
}
/** Entry point: decides whether a field outcome needs recovery and why. */
export function detectFailure(field, outcome) {
    if (outcome.status !== "resolved")
        return diagnose(outcome);
    return checkPlausibility(field, outcome);
}
//# sourceMappingURL=failure-detector.js.map
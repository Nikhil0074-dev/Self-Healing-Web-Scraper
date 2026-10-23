/**
 * Combines evidence into one confidence score for a repair.
 * domConfidence: how strong the DOM-only match was (0 when DOM repair found nothing).
 * visionConfidence: the vision model's own confidence (0 when vision wasn't used or disagreed).
 * agree: true when DOM repair and vision repair independently pointed at the same value.
 */
export function combineConfidence(domConfidence: number, visionConfidence: number, agree: boolean): number {
  if (agree) return Math.min(0.97, Math.max(domConfidence, visionConfidence) + 0.15);
  return Math.max(domConfidence, visionConfidence * 0.8);
}

/** A repaired selector is only auto-saved for reuse when it clears this bar. */
export const AUTO_SAVE_THRESHOLD = 0.6;
/** Below this, the field is reported unresolved rather than guessed at. */
export const ACCEPT_THRESHOLD = 0.45;

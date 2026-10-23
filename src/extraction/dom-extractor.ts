import { load, type CheerioAPI } from "cheerio";
import type { Candidate, Diagnosis, FieldOutcome, FieldSpec, ScrapeConfig, StoredRule } from "../types.js";
import { fromSelector, fromJsonLd, fromMetadata, fromSemantic, fromLabel, fromPageUrl } from "./strategies.js";
import { distinctBy } from "./compare.js";

export interface ExtractionContext {
  $: CheerioAPI;
  html: string;
  pageUrl: string;
}

export function parseHtml(html: string, pageUrl: string): ExtractionContext {
  return { $: load(html), html, pageUrl };
}

const STRATEGY_CONFIDENCE: Record<Candidate["strategy"], number> = {
  "saved-selector": 0.95,
  "seed-selector": 0.9,
  "json-ld": 0.95,
  metadata: 0.85,
  semantic: 0.7,
  label: 0.65,
  "page-url": 0.6,
  "dom-repair": 0.6,
  "vision-repair": 0.45,
};

/** Runs every applicable strategy for one field and folds the results into a single outcome. */
export function resolveField(
  ctx: ExtractionContext,
  field: FieldSpec,
  savedRule: StoredRule | undefined,
  jsonldTypes: string[]
): FieldOutcome {
  const { $, pageUrl } = ctx;
  const warnings: string[] = [];
  const all: Candidate[] = [];

  if (savedRule) all.push(...fromSelector($, field, savedRule.selector, savedRule.attr, "saved-selector", pageUrl));
  if (field.seedSelector) all.push(...fromSelector($, field, field.seedSelector, field.attr, "seed-selector", pageUrl));
  all.push(...fromJsonLd($, field, jsonldTypes, pageUrl));
  all.push(...fromMetadata($, field, pageUrl));
  all.push(...fromSemantic($, field, pageUrl));
  all.push(...fromLabel($, field, pageUrl));
  all.push(...fromPageUrl(field, pageUrl));

  return foldCandidates(field, all, warnings);
}

/**
 * Groups candidates by agreeing value, picks the group with the strongest combined evidence,
 * and flags ambiguity when two groups of similar strength disagree.
 */
export function foldCandidates(field: FieldSpec, all: Candidate[], warnings: string[]): FieldOutcome {
  if (all.length === 0) {
    return { field: field.name, status: "missing", candidates: [], confidence: 0, warnings };
  }

  const groups: { value: Candidate["value"]; members: Candidate[] }[] = [];
  for (const c of all) {
    const group = groups.find((g) => sameValue(field, g.value, c.value));
    if (group) group.members.push(c);
    else groups.push({ value: c.value, members: [c] });
  }

  for (const g of groups) {
    g.members.sort((a, b) => STRATEGY_CONFIDENCE[b.strategy] - STRATEGY_CONFIDENCE[a.strategy]);
  }
  groups.sort((a, b) => groupScore(b) - groupScore(a));

  const best = groups[0]!;
  const bestCandidate = best.members[0]!;

  if (bestCandidate.matchCount > 1 && best.members.length === 1 && groups.length === 1) {
    // A single strategy matched several elements but they all agree on one value: not ambiguous, just repeated markup.
  }

  if (groups.length > 1) {
    const second = groups[1]!;
    const gap = groupScore(best) - groupScore(second);
    if (gap < 0.15) {
      return {
        field: field.name,
        status: "ambiguous",
        candidates: all,
        confidence: 0,
        warnings: [...warnings, `Found ${groups.length} conflicting values with similar support.`],
        detail: `Top candidates: ${JSON.stringify(best.value)} vs ${JSON.stringify(second.value)}`,
      };
    }
  }

  if (bestCandidate.matchCount > 1 && groups.length === 1 && new Set(all.map((c) => String(c.value))).size > 1) {
    return {
      field: field.name,
      status: "ambiguous",
      candidates: all,
      confidence: 0,
      warnings: [...warnings, "Selector matched multiple elements with different values."],
    };
  }

  return {
    field: field.name,
    status: "resolved",
    value: bestCandidate.value,
    strategy: bestCandidate.strategy,
    selector: bestCandidate.selector,
    attr: bestCandidate.attr,
    raw: bestCandidate.raw,
    stable: bestCandidate.stable,
    candidates: all,
    confidence: groupScore(best),
    warnings,
  };
}

function sameValue(field: FieldSpec, a: Candidate["value"], b: Candidate["value"]): boolean {
  return distinctBy(field.kind, [{ value: a }, { value: b }]).length === 1;
}

function groupScore(group: { members: Candidate[] }): number {
  const strategies = new Set(group.members.map((m) => m.strategy));
  const base = Math.max(...group.members.map((m) => STRATEGY_CONFIDENCE[m.strategy]));
  const agreementBonus = Math.min(0.15, (strategies.size - 1) * 0.08);
  return Math.min(0.99, base + agreementBonus);
}

/** Turns a non-resolved outcome into a diagnosis the recovery system can act on. */
export function diagnose(outcome: FieldOutcome): Diagnosis {
  if (outcome.status === "missing") {
    return { field: outcome.field, reason: "missing", detail: "No strategy found any matching element.", candidates: [] };
  }
  if (outcome.status === "ambiguous") {
    return {
      field: outcome.field,
      reason: "ambiguous",
      detail: outcome.detail ?? "Multiple conflicting values were found.",
      candidates: outcome.candidates,
    };
  }
  return { field: outcome.field, reason: "invalid", detail: "The matched value failed parsing or validation.", candidates: outcome.candidates };
}

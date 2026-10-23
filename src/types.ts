import type { ZodTypeAny } from "zod";

export type FieldKind = "text" | "price" | "availability" | "url";
export type FieldValue = string | number;

/** Describes one field the user wants to extract. */
export interface FieldSpec {
  name: string;
  kind: FieldKind;
  /** If true and the field cannot be resolved, the whole scrape fails. Vision recovery is only used for required fields. */
  required: boolean;
  /** Words that usually appear in ids, classes or test ids of this field (for example "price"). */
  hints: string[];
  /** Visible label words (for example "price"). Used for "Label: value" layouts. */
  labels?: string[];
  /** Dotted paths inside a JSON-LD node (for example "offers.price"). */
  jsonld?: string[];
  /** Meta tag names/properties/itemprops. Use "canonical" for link[rel=canonical]. */
  meta?: string[];
  /** The selector the user originally knows about. Tried first until a rule is saved. */
  seedSelector?: string;
  /** Read this attribute instead of the element text. */
  attr?: string;
  /** Plain-English description sent to the vision model. */
  description: string;
  /** Used when the field cannot be resolved. The result is marked "defaulted". */
  defaultValue?: FieldValue;
}

export interface ScrapeConfig {
  name: string;
  fields: FieldSpec[];
  schema: ZodTypeAny;
  /** JSON-LD @type values to read from. Default: ["Product"]. */
  jsonldTypes?: string[];
}

export type StrategyName =
  | "saved-selector"
  | "seed-selector"
  | "json-ld"
  | "metadata"
  | "semantic"
  | "label"
  | "page-url"
  | "dom-repair"
  | "vision-repair";

export type RuleSource = "initial" | "dom-repair" | "vision-repair";

export interface Candidate {
  raw: string;
  value: FieldValue;
  strategy: StrategyName;
  selector?: string;
  attr?: string;
  /** How many elements the selector matched. */
  matchCount: number;
  /** True when the selector is anchored on an id or data attribute rather than a position path. */
  stable?: boolean;
}

export interface StoredRule {
  siteKey: string;
  field: string;
  selector: string;
  attr?: string;
  version: number;
  confidence: number;
  source: RuleSource;
  lastValue?: FieldValue;
  updatedAt: string;
}

export type FieldStatus = "resolved" | "missing" | "ambiguous" | "invalid";

export interface FieldOutcome {
  field: string;
  status: FieldStatus;
  value?: FieldValue;
  strategy?: StrategyName;
  selector?: string;
  attr?: string;
  raw?: string;
  stable?: boolean;
  candidates: Candidate[];
  confidence: number;
  warnings: string[];
  detail?: string;
}

export type FailureReason = "missing" | "ambiguous" | "invalid" | "implausible" | "mismatch";

export interface Diagnosis {
  field: string;
  reason: FailureReason;
  detail: string;
  candidates: Candidate[];
}

export type FieldFinalStatus = "ok" | "repaired" | "defaulted" | "unresolved";

export interface FieldResult {
  field: string;
  status: FieldFinalStatus;
  value?: FieldValue;
  strategy?: StrategyName;
  selector?: string;
  attr?: string;
  confidence: number;
  /** Human-readable proof of where the value came from. */
  evidence: string;
  warnings: string[];
}

export interface RepairRecord {
  field: string;
  reason: FailureReason;
  method: "dom" | "vision" | "none";
  success: boolean;
  attempts: number;
  selector?: string;
  previousSelector?: string;
  value?: FieldValue;
  confidence?: number;
  detail: string;
}

export type ScrapeStatus = "success" | "partial" | "failed";

export interface ScrapeResult {
  url: string;
  status: ScrapeStatus;
  data: Record<string, unknown> | null;
  fields: Record<string, FieldResult>;
  unresolved: string[];
  repairs: RepairRecord[];
  validationErrors: string[];
  error?: string;
  durationMs: number;
}

export interface ElementBox {
  idx: number;
  tag: string;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PixelBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

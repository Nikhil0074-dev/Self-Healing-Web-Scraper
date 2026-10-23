import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseHtml, resolveField } from "../src/extraction/dom-extractor.js";
import { detectFailure, checkPlausibility } from "../src/recovery/failure-detector.js";
import { attemptDomRepair } from "../src/recovery/locator-repair.js";
import { combineConfidence, AUTO_SAVE_THRESHOLD, ACCEPT_THRESHOLD } from "../src/recovery/confidence.js";
import { VisionAnalyzer, parseVisionReply } from "../src/recovery/vision-analyzer.js";
import { RulesRepository, siteKeyFor } from "../src/storage/rules-repository.js";
import { productFields } from "../src/extraction/schemas.js";
import type { FieldOutcome, FieldSpec } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");
const readFixture = (name: string) => readFileSync(join(fixturesDir, name), "utf-8");
const field = (name: string): FieldSpec => productFields.find((f) => f.name === name)!;
const BASE_URL = "https://shop.example.com/products/headphones";

describe("detectFailure / checkPlausibility", () => {
  it("flags a missing field for recovery", () => {
    const outcome: FieldOutcome = { field: "price", status: "missing", candidates: [], confidence: 0, warnings: [] };
    const diagnosis = detectFailure(field("price"), outcome);
    expect(diagnosis?.reason).toBe("missing");
  });

  it("flags an ambiguous field for recovery", () => {
    const outcome: FieldOutcome = { field: "price", status: "ambiguous", candidates: [], confidence: 0, warnings: [] };
    const diagnosis = detectFailure(field("price"), outcome);
    expect(diagnosis?.reason).toBe("ambiguous");
  });

  it("flags a resolved zero price as implausible rather than accepting it", () => {
    const outcome: FieldOutcome = {
      field: "price",
      status: "resolved",
      value: 0,
      strategy: "semantic",
      candidates: [],
      confidence: 0.7,
      warnings: [],
    };
    const diagnosis = checkPlausibility(field("price"), outcome);
    expect(diagnosis?.reason).toBe("implausible");
  });

  it("flags a resolved but low-confidence value for recovery", () => {
    const outcome: FieldOutcome = {
      field: "price",
      status: "resolved",
      value: 2499,
      strategy: "label",
      candidates: [],
      confidence: 0.3,
      warnings: [],
    };
    expect(checkPlausibility(field("price"), outcome)?.reason).toBe("implausible");
  });

  it("does not flag a normal, confident, resolved value", () => {
    const outcome: FieldOutcome = {
      field: "price",
      status: "resolved",
      value: 2499,
      strategy: "json-ld",
      candidates: [],
      confidence: 0.9,
      warnings: [],
    };
    expect(detectFailure(field("price"), outcome)).toBeNull();
  });
});

describe("attemptDomRepair (self-healing after a selector rename)", () => {
  it("finds the renamed price element using a fallback hint word", () => {
    const ctx = parseHtml(readFixture("product-v2-renamed.html"), BASE_URL);
    const firstPass = resolveField(ctx, field("price"), undefined, ["Product"]);
    expect(firstPass.status).toBe("missing");

    const diagnosis = detectFailure(field("price"), firstPass)!;
    const repaired = attemptDomRepair(ctx, field("price"), diagnosis);

    expect(repaired.status).toBe("resolved");
    expect(repaired.value).toBe(2499);
    expect(repaired.strategy).toBe("dom-repair");
    expect(repaired.confidence).toBeLessThan(0.9); // repaired matches are never as trusted as a direct hit
  });

  it("still reports missing when the page truly has no price anywhere", () => {
    const ctx = parseHtml(readFixture("product-v5-missing-price.html"), BASE_URL);
    const firstPass = resolveField(ctx, field("price"), undefined, ["Product"]);
    const diagnosis = detectFailure(field("price"), firstPass)!;
    const repaired = attemptDomRepair(ctx, field("price"), diagnosis);
    expect(repaired.status).toBe("missing");
  });
});

describe("combineConfidence", () => {
  it("boosts confidence when DOM and vision agree", () => {
    const agreeing = combineConfidence(0.6, 0.7, true);
    const domOnly = combineConfidence(0.6, 0, false);
    expect(agreeing).toBeGreaterThan(domOnly);
  });

  it("discounts a vision-only result relative to its raw confidence", () => {
    const visionOnly = combineConfidence(0, 0.9, false);
    expect(visionOnly).toBeLessThan(0.9);
  });

  it("thresholds are ordered sensibly", () => {
    expect(AUTO_SAVE_THRESHOLD).toBeGreaterThan(ACCEPT_THRESHOLD);
  });
});

describe("VisionAnalyzer", () => {
  it("reports unavailable when no API key and no backend are given", async () => {
    const analyzer = new VisionAnalyzer({});
    expect(analyzer.available).toBe(false);
    const answer = await analyzer.analyze({ screenshotPngBase64: "", boxes: [], fieldDescription: "", fieldName: "price" });
    expect(answer.idx).toBeNull();
  });

  it("uses an injected backend and returns its answer", async () => {
    const analyzer = new VisionAnalyzer({
      backend: async () => ({ idx: 2, confidence: 0.8, reason: "price text near top right" }),
    });
    expect(analyzer.available).toBe(true);
    const answer = await analyzer.analyze({ screenshotPngBase64: "x", boxes: [], fieldDescription: "price", fieldName: "price" });
    expect(answer.idx).toBe(2);
    expect(answer.confidence).toBe(0.8);
  });

  it("degrades gracefully when the backend throws", async () => {
    const analyzer = new VisionAnalyzer({
      backend: async () => {
        throw new Error("network down");
      },
    });
    const answer = await analyzer.analyze({ screenshotPngBase64: "x", boxes: [], fieldDescription: "price", fieldName: "price" });
    expect(answer.idx).toBeNull();
    expect(answer.reason).toContain("network down");
  });
});

describe("parseVisionReply", () => {
  it("parses a clean JSON reply", () => {
    const answer = parseVisionReply('{"idx": 1, "confidence": 0.9, "reason": "top right"}');
    expect(answer).toEqual({ idx: 1, confidence: 0.9, reason: "top right" });
  });
  it("parses a reply wrapped in markdown code fences", () => {
    const answer = parseVisionReply('```json\n{"idx": null, "confidence": 0, "reason": "not found"}\n```');
    expect(answer.idx).toBeNull();
  });
  it("falls back safely on unparseable text", () => {
    const answer = parseVisionReply("I think it's the second one");
    expect(answer.idx).toBeNull();
    expect(answer.confidence).toBe(0);
  });
  it("clamps an out-of-range confidence value", () => {
    const answer = parseVisionReply('{"idx": 0, "confidence": 5, "reason": "x"}');
    expect(answer.confidence).toBe(1);
  });
});

describe("RulesRepository", () => {
  let db: RulesRepository;
  beforeEach(() => {
    db = new RulesRepository(":memory:");
  });
  afterEach(() => {
    db.close();
  });

  it("returns undefined for a rule that was never saved", () => {
    expect(db.getRule("example.com/", "price")).toBeUndefined();
  });

  it("saves and retrieves a rule, incrementing its version on update", () => {
    const first = db.saveRule({ siteKey: "example.com/", field: "price", selector: "#a", confidence: 0.8, source: "initial" });
    expect(first.version).toBe(1);
    const second = db.saveRule({ siteKey: "example.com/", field: "price", selector: "#b", confidence: 0.7, source: "dom-repair" });
    expect(second.version).toBe(2);
    expect(db.getRule("example.com/", "price")?.selector).toBe("#b");
  });

  it("records jobs, field results and repairs, and can read them back", () => {
    const jobId = db.startJob("https://example.com/p/1", "example.com/p/");
    db.recordFieldResult(jobId, "price", "ok", 2499, "json-ld", "#a", 0.9);
    db.recordRepair(jobId, {
      field: "price",
      reason: "missing",
      method: "dom",
      success: true,
      attempts: 1,
      selector: "#a",
      value: 2499,
      confidence: 0.7,
      detail: "repaired",
    });
    db.finishJob(jobId, "success", 120);

    const detail = db.getJobDetail(jobId);
    expect(detail.job?.["status"]).toBe("success");
    expect(detail.fields).toHaveLength(1);
    expect(detail.repairs).toHaveLength(1);
    expect(db.getRecentJobs(5)).toHaveLength(1);
  });

  it("scopes rules to a site key derived from hostname and path", () => {
    expect(siteKeyFor("https://shop.example.com/products/headphones?x=1")).toBe("shop.example.com/products/");
    expect(siteKeyFor("https://shop.example.com/")).toBe("shop.example.com/");
  });
});

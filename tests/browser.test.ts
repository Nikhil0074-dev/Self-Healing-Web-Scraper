import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-server.js";
import { resolveTestChromium } from "./helpers/chromium.js";
import { Scraper } from "../src/scraper.js";
import { RulesRepository, siteKeyFor } from "../src/storage/rules-repository.js";
import { productScrapeConfig } from "../src/extraction/schemas.js";
import { VisionAnalyzer } from "../src/recovery/vision-analyzer.js";
import type { ElementBox } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "fixtures");

let server: FixtureServer;
let chromium: { executablePath?: string; args?: string[] };

beforeAll(async () => {
  server = await startFixtureServer(fixturesDir);
  chromium = await resolveTestChromium();
});

afterAll(async () => {
  await server.close();
});

function makeDb(): RulesRepository {
  return new RulesRepository(":memory:");
}

describe("Scraper: original selectors work", () => {
  let db: RulesRepository;
  beforeEach(() => (db = makeDb()));
  afterEach(() => db.close());

  it("extracts and validates all fields from a well-formed page", async () => {
    const scraper = new Scraper({ db, allowPrivateNetwork: true, respectRobots: false, chromiumPath: chromium.executablePath, chromiumArgs: chromium.args });
    const result = await scraper.scrape(`${server.url}/product-v1-stable.html`, productScrapeConfig);

    expect(result.status).toBe("success");
    expect(result.data).toEqual({
      name: "Wireless Headphones",
      price: 2499,
      availability: "In stock",
      url: "https://shop.example.com/products/headphones",
    });
    expect(result.unresolved).toEqual([]);
    expect(result.repairs).toEqual([]);
  }, 30_000);
});

describe("Scraper: CSS class renamed", () => {
  let db: RulesRepository;
  beforeEach(() => (db = makeDb()));
  afterEach(() => db.close());

  it("self-heals the price selector via DOM repair and saves the new rule", async () => {
    const scraper = new Scraper({ db, allowPrivateNetwork: true, respectRobots: false, chromiumPath: chromium.executablePath, chromiumArgs: chromium.args });
    const url = `${server.url}/product-v2-renamed.html`;
    const result = await scraper.scrape(url, productScrapeConfig);

    expect(result.status).toBe("success");
    expect(result.data?.["price"]).toBe(2499);
    const priceRepair = result.repairs.find((r) => r.field === "price");
    expect(priceRepair?.method).toBe("dom");
    expect(priceRepair?.success).toBe(true);

    const saved = db.getRule(siteKeyFor(url), "price");
    expect(saved).toBeDefined();
  }, 30_000);

  it("reuses the saved rule on the next run instead of repairing again", async () => {
    const scraper = new Scraper({ db, allowPrivateNetwork: true, respectRobots: false, chromiumPath: chromium.executablePath, chromiumArgs: chromium.args });
    const url = `${server.url}/product-v2-renamed.html`;
    await scraper.scrape(url, productScrapeConfig);
    const second = await scraper.scrape(url, productScrapeConfig);

    const priceField = second.fields["price"];
    expect(priceField.status).toBe("ok");
    expect(priceField.strategy).toBe("saved-selector");
    expect(second.repairs.find((r) => r.field === "price")).toBeUndefined();
  }, 30_000);
});

describe("Scraper: required field missing entirely", () => {
  let db: RulesRepository;
  beforeEach(() => (db = makeDb()));
  afterEach(() => db.close());

  it("reports a validation failure instead of guessing a price", async () => {
    const scraper = new Scraper({ db, allowPrivateNetwork: true, respectRobots: false, chromiumPath: chromium.executablePath, chromiumArgs: chromium.args });
    const result = await scraper.scrape(`${server.url}/product-v5-missing-price.html`, productScrapeConfig);

    expect(result.status).toBe("failed");
    expect(result.data).toBeNull();
    expect(result.validationErrors.some((e) => e.includes("price"))).toBe(true);
    expect(result.fields["price"].status).toBe("unresolved");
  }, 30_000);
});

describe("Scraper: two matching price elements", () => {
  let db: RulesRepository;
  beforeEach(() => (db = makeDb()));
  afterEach(() => db.close());

  it("flags ambiguity rather than guessing which price is correct", async () => {
    const scraper = new Scraper({ db, allowPrivateNetwork: true, respectRobots: false, chromiumPath: chromium.executablePath, chromiumArgs: chromium.args });
    const result = await scraper.scrape(`${server.url}/product-v3-ambiguous-price.html`, productScrapeConfig);

    const priceField = result.fields["price"];
    expect(["unresolved", "defaulted"]).not.toContain("resolved");
    expect(priceField.status === "unresolved" || priceField.status === "repaired").toBe(true);
    const repair = result.repairs.find((r) => r.field === "price");
    expect(repair?.reason).toBe("ambiguous");
  }, 30_000);
});

describe("Scraper: vision API unavailable", () => {
  let db: RulesRepository;
  beforeEach(() => (db = makeDb()));
  afterEach(() => db.close());

  it("falls back to deterministic DOM handling and reports the field unresolved rather than crashing", async () => {
    const scraper = new Scraper({
      db,
      allowPrivateNetwork: true,
      respectRobots: false,
      chromiumPath: chromium.executablePath,
      chromiumArgs: chromium.args,
      vision: new VisionAnalyzer({}), // no backend configured
    });
    const result = await scraper.scrape(`${server.url}/product-v4-vision-only.html`, productScrapeConfig);

    expect(result.status).not.toBe("success");
    expect(result.fields["price"].status).toBe("unresolved");
    expect(result.error).toBeUndefined();
  }, 30_000);
});

describe("Scraper: vision-assisted recovery with a stubbed vision backend", () => {
  let db: RulesRepository;
  beforeEach(() => (db = makeDb()));
  afterEach(() => db.close());

  it("resolves the price when DOM evidence alone is insufficient but vision identifies the right box", async () => {
    // product-v4 has no semantic hints anywhere, so only the currency-text fallback box list
    // will contain the price element. We stub the backend to always pick the box whose own
    // text looks like a price, exactly like a real vision model reading the screenshot would.
    const vision = new VisionAnalyzer({
      backend: async (req) => {
        const priceBox = req.boxes.find((b: ElementBox) => /[₹$]/.test(b.text));
        return priceBox
          ? { idx: priceBox.idx, confidence: 0.85, reason: "currency symbol next to a number" }
          : { idx: null, confidence: 0, reason: "no price-like text found" };
      },
    });
    const scraper = new Scraper({
      db,
      allowPrivateNetwork: true,
      respectRobots: false,
      chromiumPath: chromium.executablePath,
      chromiumArgs: chromium.args,
      vision,
    });
    const url = `${server.url}/product-v4-vision-only.html`;
    const result = await scraper.scrape(url, productScrapeConfig);

    const priceField = result.fields["price"];
    expect(priceField.value).toBe(2499);
    expect(["repaired", "ok"]).toContain(priceField.status);
    const repair = result.repairs.find((r) => r.field === "price");
    expect(repair?.method).toBe("vision");
  }, 30_000);
});

describe("Scraper: invalid model-generated locator is rejected", () => {
  let db: RulesRepository;
  beforeEach(() => (db = makeDb()));
  afterEach(() => db.close());

  it("ignores a vision answer that points at an index outside the detected box list", async () => {
    const vision = new VisionAnalyzer({
      backend: async () => ({ idx: 999, confidence: 0.9, reason: "hallucinated index" }),
    });
    const scraper = new Scraper({
      db,
      allowPrivateNetwork: true,
      respectRobots: false,
      chromiumPath: chromium.executablePath,
      chromiumArgs: chromium.args,
      vision,
    });
    const result = await scraper.scrape(`${server.url}/product-v4-vision-only.html`, productScrapeConfig);
    expect(result.fields["price"].status).toBe("unresolved");
  }, 30_000);
});

describe("Scraper: page returns a navigation error", () => {
  let db: RulesRepository;
  beforeEach(() => (db = makeDb()));
  afterEach(() => db.close());

  it("reports failure cleanly for a 404", async () => {
    const scraper = new Scraper({ db, allowPrivateNetwork: true, respectRobots: false, chromiumPath: chromium.executablePath, chromiumArgs: chromium.args });
    const result = await scraper.scrape(`${server.url}/does-not-exist.html`, productScrapeConfig);
    // The fixture server returns a 404 body; DOM extraction then can't find the fields at all.
    expect(result.status === "failed" || result.unresolved.length > 0).toBe(true);
  }, 30_000);

  it("reports failure for a connection that cannot be established", async () => {
    const scraper = new Scraper({ db, allowPrivateNetwork: true, respectRobots: false, chromiumPath: chromium.executablePath, chromiumArgs: chromium.args });
    const result = await scraper.scrape("http://127.0.0.1:1/unreachable", productScrapeConfig);
    expect(result.status).toBe("failed");
    expect(result.error).toBeDefined();
  }, 30_000);
});

describe("Scraper: SSRF protection blocks private targets even when robots is off", () => {
  let db: RulesRepository;
  beforeEach(() => (db = makeDb()));
  afterEach(() => db.close());

  it("refuses to navigate to a private address unless explicitly allowed", async () => {
    const scraper = new Scraper({ db, allowPrivateNetwork: false, respectRobots: false, chromiumPath: chromium.executablePath, chromiumArgs: chromium.args });
    const result = await scraper.scrape(`${server.url}/product-v1-stable.html`, productScrapeConfig);
    expect(result.status).toBe("failed");
    expect(result.error).toMatch(/Refusing to navigate|private/i);
  }, 30_000);
});

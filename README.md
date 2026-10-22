# Self-Healing Web Scraper

A scraper that extracts structured data (name, price, availability, URL) from
product pages, validates it, and repairs its own extraction rules when a
site's HTML changes — using DOM evidence first and a vision model only as a
fallback.

Status: 91/91 automated tests passing, clean TypeScript build (`strict: true`).

## What it actually does

1. Loads a page with Playwright.
2. Tries several extraction strategies in order: a saved rule from a past
   repair, the user's seed selector, JSON-LD structured data, meta tags,
   semantic attributes (`data-testid`, ARIA), and label-based text matching.
3. Validates every value with Zod (type, format, plausibility — a "price"
   with a `%` sign or two numbers in it is rejected, not guessed).
4. If a required field fails, it diagnoses *why* (missing / ambiguous /
   invalid / implausible), then tries to repair:
   - **DOM repair**: search nearby elements for a plausible replacement
     using the same hints, built from a selector anchored on an id or
     `data-*` attribute, never raw CSS classes (classes are what breaks).
   - **Vision repair**: only if DOM repair fails and a vision model is
     configured. Sends a screenshot plus a list of candidate element boxes
     (not raw pixels-to-selector guessing) and asks which box index holds
     the field. The index is checked against real boxes before it's trusted.
5. A repaired selector is only kept if it passes the schema and matches
   exactly the expected number of elements. If nothing clears that bar, the
   field is reported `unresolved` — the scraper never invents a value.
6. Successful repairs are saved per-site in SQLite and reused on the next run.

## Quick start

```bash
npm install
cp .env.example .env
npm run typecheck   # strict TypeScript, no errors
npm test            # 91 tests: parsing, DOM extraction, repair, SSRF, schema
npm run build
npm run scrape -- https://example.com/some-product
# or run the HTTP API:
npm run dev
```

### A note on Playwright's browser download

This sandbox could not reach Playwright's CDN to download Chromium
(`playwright install chromium` fails here with a network error). The code
does **not** depend on that download: `src/browser/launch.ts` accepts an
optional `SCRAPER_CHROMIUM_PATH` / `SCRAPER_CHROMIUM_ARGS` override, and the
dev dependency `@sparticuz/chromium` provides a portable Chromium binary used
automatically by the test helper (`tests/helpers/chromium.ts`) and in the
examples below. On a normal machine with internet access, just run
`npm run install:browser` once and leave those env vars unset — Playwright's
own bundled Chromium is used and nothing else changes.

```bash
# One-off manual run using the bundled fallback browser, against a URL on your machine
SCRAPER_CHROMIUM_PATH=$(node -e "import('@sparticuz/chromium').then(m=>m.default.executablePath()).then(console.log)") \
  npm run scrape -- https://example.com/some-product
```

## API

```
POST /api/scrape        { "url": "https://..." }                -> ScrapeResult
POST /api/scrape        { "url": "...", "fields": [...] }        -> custom schema
GET  /api/rules/:siteKey                                         -> saved selector rules
GET  /api/jobs?limit=20                                          -> recent job history
GET  /api/jobs/:id                                                -> one job + its repairs
GET  /health
```

Set `API_KEY` in `.env` to require an `x-api-key` header on every request
except `/health`.

## Example output

```bash
npm run scrape -- https://example.com/products/headphones
```

```json
{
  "url": "https://example.com/products/headphones",
  "status": "success",
  "data": {
    "name": "Wireless Headphones",
    "price": 2499,
    "availability": "In stock",
    "url": "https://example.com/products/headphones"
  },
  "fields": { "...": "per-field strategy, selector, confidence, evidence" },
  "repairs": [],
  "validationErrors": [],
  "durationMs": 860
}
```

When a selector breaks, the same command returns `"status": "success"` or
`"partial"` with a non-empty `repairs` array showing what changed, how
(`"method": "dom"` or `"vision"`), and the confidence of the fix — see
`tests/fixtures/product-v2-renamed.html` for a reproducible example.

## Project layout

```
src/
  browser/      Playwright launch + navigation, HTML/screenshot capture, box detection
  extraction/   parsers, DOM extraction strategies, selector builder, Zod schemas
  recovery/     failure diagnosis, DOM repair, vision repair, confidence scoring
  storage/      SQLite: saved rules, job history, per-field repair audit trail
  security/     SSRF guard (blocks localhost/private IPs/redirects), robots.txt check
  api/          Fastify routes
  cli.ts        one-shot command-line scrape
  server.ts     HTTP server entry point
  scraper.ts    orchestrates the pipeline above end to end
tests/
  extraction.test.ts   parsing + DOM strategy unit tests (JSON-LD, selectors, etc.)
  recovery.test.ts     failure detection, DOM repair, confidence scoring
  security.test.ts     SSRF and robots.txt unit tests
  validation.test.ts   Zod schema edge cases
  browser.test.ts      end-to-end: real Playwright against local HTML fixtures,
                        including the "CSS class renamed" and vision-repair scenarios
  fixtures/            5 HTML pages simulating a stable page and 4 kinds of breakage
```

## Design decisions worth knowing about

- **Selectors never use class names.** Classes are the first thing a
  redesign changes. `buildSelector` anchors on an `id` or `data-testid` when
  one uniquely matches, and falls back to a positional path only as a last
  resort — and that positional path is treated as unstable and gets a lower
  confidence score.
- **Ambiguity is a failure, not a coin flip.** If two elements both look like
  "the price," the field is marked `ambiguous` rather than picking the first
  match. See `product-v3-ambiguous-price.html`.
- **Vision is a fallback, not a first pass.** It's called only for fields DOM
  evidence couldn't resolve, and only with a cropped set of candidate boxes
  — not "read the whole page." If the vision backend isn't configured, or
  answers with something invalid, the scraper falls back to "unresolved"
  instead of crashing or guessing.
- **SSRF protection resolves DNS and blocks private ranges by default**,
  including the cloud-metadata address `169.254.169.254`, and re-checks every
  redirect hop. It's intentionally off by default for `127.0.0.1` scraping
  only when `ALLOW_PRIVATE_NETWORK=true` is set — never enable that against
  an untrusted target.

## Known limitations (stated plainly, not buried)

- No real `robots.txt` fetch cache/backoff — it fetches once per job.
- The vision repair path is tested against a stubbed vision backend (see
  `tests/browser.test.ts`); no real OpenAI API key is wired into CI here, so
  real-world vision accuracy is unverified by these tests.
- `better-sqlite3` is a native module; if you deploy to an architecture
  without a prebuilt binary you'll need `npm rebuild better-sqlite3`.
- Pagination/interaction support described in the spec (clicking "next page")
  is not implemented — this build extracts one page per request.

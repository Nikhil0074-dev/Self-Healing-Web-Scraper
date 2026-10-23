/**
 * Example: scrape a job listing instead of a product, using a custom field schema.
 * Run with: npx tsx examples/custom-schema.ts <url>
 */
import { z } from "zod";
import { loadConfig } from "../src/utils/env.js";
import { RulesRepository } from "../src/storage/rules-repository.js";
import { Scraper } from "../src/scraper.js";
import { VisionAnalyzer } from "../src/recovery/vision-analyzer.js";
import type { FieldSpec, ScrapeConfig } from "../src/types.js";

const fields: FieldSpec[] = [
  {
    name: "title",
    kind: "text",
    required: true,
    hints: ["title", "job-title", "position"],
    labels: ["title", "position"],
    jsonld: ["title"],
    description: "The job title, e.g. 'Senior Backend Engineer'.",
  },
  {
    name: "company",
    kind: "text",
    required: true,
    hints: ["company", "employer", "org"],
    jsonld: ["hiringOrganization.name"],
    description: "The hiring company's name.",
  },
  {
    name: "applyUrl",
    kind: "url",
    required: false,
    hints: ["apply", "application"],
    description: "Link to the application form.",
    defaultValue: "",
  },
];

const jobConfig: ScrapeConfig = {
  name: "job-listing",
  fields,
  schema: z.object({
    title: z.string().min(1),
    company: z.string().min(1),
    applyUrl: z.string().optional(),
  }),
};

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error("Usage: npx tsx examples/custom-schema.ts <url>");
    process.exit(1);
  }
  const config = loadConfig();
  const db = new RulesRepository(config.dbPath);
  const vision = new VisionAnalyzer({ apiKey: config.openaiApiKey, model: config.openaiVisionModel });
  const scraper = new Scraper({
    db,
    userAgent: config.userAgent,
    allowPrivateNetwork: config.allowPrivateNetwork,
    respectRobots: config.respectRobots,
    chromiumPath: config.chromiumPath,
    chromiumArgs: config.chromiumArgs,
    vision,
  });

  const result = await scraper.scrape(url, jobConfig);
  console.log(JSON.stringify(result, null, 2));
  db.close();
}

void main();

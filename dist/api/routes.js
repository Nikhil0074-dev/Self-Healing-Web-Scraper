import { z } from "zod";
import { Scraper } from "../scraper.js";
import { siteKeyFor } from "../storage/rules-repository.js";
import { buildZodSchema, productScrapeConfig } from "../extraction/schemas.js";
import { Semaphore } from "../utils/concurrency.js";
import { logger } from "../utils/logger.js";
import { VisionAnalyzer } from "../recovery/vision-analyzer.js";
const FieldSpecSchema = z.object({
    name: z.string().trim().min(1).max(100),
    kind: z.enum(["text", "price", "availability", "url"]),
    required: z.boolean().default(true),
    hints: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
    labels: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
    jsonld: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    meta: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    seedSelector: z.string().trim().min(1).max(500).optional(),
    attr: z.string().trim().min(1).max(100).optional(),
    description: z.string().max(500).default(""),
    defaultValue: z.union([z.string().max(500), z.number().finite()]).optional(),
});
const ScrapeRequestSchema = z.object({
    url: z.string().url(),
    schemaName: z.literal("product").optional(),
    fields: z.array(FieldSpecSchema).min(1).max(50).optional(),
    jsonldTypes: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
}).superRefine((value, ctx) => {
    if (!value.fields)
        return;
    const names = new Set();
    for (const field of value.fields) {
        if (names.has(field.name)) {
            ctx.addIssue({ code: "custom", path: ["fields"], message: `Duplicate field name: ${field.name}` });
        }
        names.add(field.name);
    }
});
function resolveConfig(body) {
    if (body.fields && body.fields.length > 0) {
        return {
            name: "custom",
            fields: body.fields,
            schema: buildZodSchema(body.fields),
            jsonldTypes: body.jsonldTypes,
        };
    }
    return productScrapeConfig;
}
export function registerRoutes(app, deps) {
    const semaphore = new Semaphore(deps.config.maxConcurrentJobs);
    const vision = new VisionAnalyzer({ apiKey: deps.config.openaiApiKey, model: deps.config.openaiVisionModel });
    app.addHook("onRequest", async (req, reply) => {
        if (!deps.config.apiKey)
            return;
        if (req.url === "/health")
            return;
        const header = req.headers["x-api-key"];
        if (header !== deps.config.apiKey) {
            return reply.code(401).send({ error: "Missing or invalid x-api-key header." });
        }
    });
    app.get("/health", async () => ({ status: "ok" }));
    app.post("/api/scrape", async (req, reply) => {
        const parsed = ScrapeRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.code(400).send({ error: "Invalid request body.", issues: parsed.error.issues });
        }
        const config = resolveConfig(parsed.data);
        const release = await semaphore.acquire();
        try {
            const scraper = new Scraper({
                db: deps.db,
                userAgent: deps.config.userAgent,
                allowPrivateNetwork: deps.config.allowPrivateNetwork,
                respectRobots: deps.config.respectRobots,
                chromiumPath: deps.config.chromiumPath,
                chromiumArgs: deps.config.chromiumArgs,
                vision,
            });
            const result = await scraper.scrape(parsed.data.url, config);
            logger.info("scrape finished", { url: parsed.data.url, status: result.status });
            return result;
        }
        catch (err) {
            logger.error("scrape crashed", { url: parsed.data.url, error: String(err) });
            return reply.code(500).send({ error: err instanceof Error ? err.message : "Unknown error." });
        }
        finally {
            release();
        }
    });
    app.get("/api/rules/:siteKey", async (req) => {
        const { siteKey } = req.params;
        return { siteKey, rules: deps.db.getRulesForSite(decodeURIComponent(siteKey)) };
    });
    app.get("/api/jobs", async (req) => {
        const { limit } = req.query;
        const parsedLimit = limit === undefined ? 20 : Number(limit);
        const safeLimit = Number.isInteger(parsedLimit) && parsedLimit >= 1 && parsedLimit <= 100 ? parsedLimit : 20;
        return { jobs: deps.db.getRecentJobs(safeLimit) };
    });
    app.get("/api/jobs/:id", async (req, reply) => {
        const { id } = req.params;
        const jobId = Number(id);
        if (!Number.isFinite(jobId))
            return reply.code(400).send({ error: "Invalid job id." });
        const detail = deps.db.getJobDetail(jobId);
        if (!detail.job)
            return reply.code(404).send({ error: "Job not found." });
        return detail;
    });
}
export { siteKeyFor };
//# sourceMappingURL=routes.js.map
import { loadConfig } from "./utils/env.js";
import { RulesRepository } from "./storage/rules-repository.js";
import { Scraper } from "./scraper.js";
import { productScrapeConfig } from "./extraction/schemas.js";
import { VisionAnalyzer } from "./recovery/vision-analyzer.js";
async function main() {
    const url = process.argv[2];
    if (!url) {
        console.error("Usage: npm run scrape -- <url>");
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
    const result = await scraper.scrape(url, productScrapeConfig);
    console.log(JSON.stringify(result, null, 2));
    db.close();
    process.exit(result.status === "failed" ? 1 : 0);
}
void main();
//# sourceMappingURL=cli.js.map
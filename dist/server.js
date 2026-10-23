import Fastify from "fastify";
import { loadConfig } from "./utils/env.js";
import { RulesRepository } from "./storage/rules-repository.js";
import { registerRoutes } from "./api/routes.js";
import { logger } from "./utils/logger.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
export function buildServer() {
    const config = loadConfig();
    const db = new RulesRepository(config.dbPath);
    const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
    registerRoutes(app, { db, config });
    app.addHook("onClose", async () => {
        db.close();
    });
    return { app, config };
}
async function main() {
    const { app, config } = buildServer();
    try {
        await app.listen({ port: config.port, host: config.host });
        logger.info(`Server listening on http://${config.host}:${config.port}`);
    }
    catch (err) {
        logger.error("Failed to start server", { error: String(err) });
        process.exit(1);
    }
}
const isMain = process.argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (isMain) {
    void main();
}
//# sourceMappingURL=server.js.map
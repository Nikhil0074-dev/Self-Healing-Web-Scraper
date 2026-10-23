function number(value, fallback, min, max) {
    const parsed = Number(value ?? fallback);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? Math.floor(parsed) : fallback;
}
function bool(value, fallback) {
    if (value === undefined || value === "")
        return fallback;
    return value.toLowerCase() === "true" || value === "1";
}
export function loadConfig(env = process.env) {
    return {
        port: number(env["PORT"], 3000, 1, 65535),
        host: env["HOST"] ?? "127.0.0.1",
        dbPath: env["DB_PATH"] ?? "./data/scraper.db",
        apiKey: env["API_KEY"] || undefined,
        maxConcurrentJobs: number(env["MAX_CONCURRENT_JOBS"], 3, 1, 100),
        userAgent: env["USER_AGENT"] ?? "SelfHealingScraper/1.0",
        respectRobots: bool(env["RESPECT_ROBOTS"], true),
        allowPrivateNetwork: bool(env["ALLOW_PRIVATE_NETWORK"], false),
        chromiumPath: env["SCRAPER_CHROMIUM_PATH"] || undefined,
        chromiumArgs: env["SCRAPER_CHROMIUM_ARGS"] ? env["SCRAPER_CHROMIUM_ARGS"].split(" ").filter(Boolean) : undefined,
        openaiApiKey: env["OPENAI_API_KEY"] || undefined,
        openaiVisionModel: env["OPENAI_VISION_MODEL"] ?? "gpt-4o",
    };
}
//# sourceMappingURL=env.js.map
function log(level, message, meta) {
    const line = { time: new Date().toISOString(), level, message, ...meta };
    const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    out(JSON.stringify(line));
}
export const logger = {
    info: (message, meta) => log("info", message, meta),
    warn: (message, meta) => log("warn", message, meta),
    error: (message, meta) => log("error", message, meta),
};
//# sourceMappingURL=logger.js.map
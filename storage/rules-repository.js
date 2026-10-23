import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export function siteKeyFor(url) {
    const u = new URL(url);
    return `${u.hostname}${u.pathname.replace(/\/[^/]*$/, "/")}`.toLowerCase();
}
export class RulesRepository {
    db;
    constructor(path) {
        if (path !== ":memory:")
            mkdirSync(dirname(path), { recursive: true });
        this.db = new Database(path);
        this.db.pragma("journal_mode = WAL");
        this.migrate();
    }
    migrate() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS rules (
        site_key TEXT NOT NULL,
        field TEXT NOT NULL,
        selector TEXT NOT NULL,
        attr TEXT,
        version INTEGER NOT NULL,
        confidence REAL NOT NULL,
        source TEXT NOT NULL,
        last_value TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (site_key, field)
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        site_key TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS field_results (
        job_id INTEGER NOT NULL,
        field TEXT NOT NULL,
        status TEXT NOT NULL,
        value TEXT,
        strategy TEXT,
        selector TEXT,
        confidence REAL,
        FOREIGN KEY (job_id) REFERENCES jobs(id)
      );

      CREATE TABLE IF NOT EXISTS repairs (
        job_id INTEGER NOT NULL,
        field TEXT NOT NULL,
        reason TEXT NOT NULL,
        method TEXT NOT NULL,
        success INTEGER NOT NULL,
        attempts INTEGER NOT NULL,
        selector TEXT,
        previous_selector TEXT,
        confidence REAL,
        detail TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (job_id) REFERENCES jobs(id)
      );
    `);
    }
    getRule(siteKey, field) {
        const row = this.db
            .prepare(`SELECT * FROM rules WHERE site_key = ? AND field = ?`)
            .get(siteKey, field);
        if (!row)
            return undefined;
        return {
            siteKey: row["site_key"],
            field: row["field"],
            selector: row["selector"],
            attr: row["attr"] ?? undefined,
            version: row["version"],
            confidence: row["confidence"],
            source: row["source"],
            lastValue: row["last_value"] ?? undefined,
            updatedAt: row["updated_at"],
        };
    }
    getRulesForSite(siteKey) {
        const rows = this.db.prepare(`SELECT * FROM rules WHERE site_key = ?`).all(siteKey);
        return rows.map((row) => ({
            siteKey: row["site_key"],
            field: row["field"],
            selector: row["selector"],
            attr: row["attr"] ?? undefined,
            version: row["version"],
            confidence: row["confidence"],
            source: row["source"],
            lastValue: row["last_value"] ?? undefined,
            updatedAt: row["updated_at"],
        }));
    }
    saveRule(rule) {
        const existing = this.getRule(rule.siteKey, rule.field);
        const version = (existing?.version ?? 0) + 1;
        const updatedAt = new Date().toISOString();
        this.db
            .prepare(`INSERT INTO rules (site_key, field, selector, attr, version, confidence, source, last_value, updated_at)
         VALUES (@siteKey, @field, @selector, @attr, @version, @confidence, @source, @lastValue, @updatedAt)
         ON CONFLICT(site_key, field) DO UPDATE SET
           selector = excluded.selector, attr = excluded.attr, version = excluded.version,
           confidence = excluded.confidence, source = excluded.source, last_value = excluded.last_value,
           updated_at = excluded.updated_at`)
            .run({
            siteKey: rule.siteKey,
            field: rule.field,
            selector: rule.selector,
            attr: rule.attr ?? null,
            version,
            confidence: rule.confidence,
            source: rule.source,
            lastValue: rule.lastValue !== undefined ? String(rule.lastValue) : null,
            updatedAt,
        });
        return { ...rule, version, updatedAt };
    }
    startJob(url, siteKey) {
        const info = this.db
            .prepare(`INSERT INTO jobs (url, site_key, status, started_at) VALUES (?, ?, 'running', ?)`)
            .run(url, siteKey, new Date().toISOString());
        return Number(info.lastInsertRowid);
    }
    finishJob(jobId, status, durationMs, error) {
        this.db
            .prepare(`UPDATE jobs SET status = ?, finished_at = ?, duration_ms = ?, error = ? WHERE id = ?`)
            .run(status, new Date().toISOString(), durationMs, error ?? null, jobId);
    }
    recordFieldResult(jobId, field, status, value, strategy, selector, confidence) {
        this.db
            .prepare(`INSERT INTO field_results (job_id, field, status, value, strategy, selector, confidence) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(jobId, field, status, value !== undefined ? String(value) : null, strategy ?? null, selector ?? null, confidence);
    }
    recordRepair(jobId, repair) {
        this.db
            .prepare(`INSERT INTO repairs (job_id, field, reason, method, success, attempts, selector, previous_selector, confidence, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
            .run(jobId, repair.field, repair.reason, repair.method, repair.success ? 1 : 0, repair.attempts, repair.selector ?? null, repair.previousSelector ?? null, repair.confidence ?? null, repair.detail, new Date().toISOString());
    }
    getRecentJobs(limit = 20) {
        return this.db.prepare(`SELECT * FROM jobs ORDER BY id DESC LIMIT ?`).all(limit);
    }
    getJobDetail(jobId) {
        const job = this.db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId);
        const fields = this.db.prepare(`SELECT * FROM field_results WHERE job_id = ?`).all(jobId);
        const repairs = this.db.prepare(`SELECT * FROM repairs WHERE job_id = ?`).all(jobId);
        return { job, fields, repairs };
    }
    close() {
        this.db.close();
    }
}
//# sourceMappingURL=rules-repository.js.map
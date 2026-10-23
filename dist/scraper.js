import { openSession, navigate } from "./browser/launch.js";
import { captureHtml, captureScreenshot, captureCandidateBoxes, locateElementAt } from "./browser/capture.js";
import { checkRobotsAllowed } from "./security/robots.js";
import { parseHtml, resolveField } from "./extraction/dom-extractor.js";
import { detectFailure } from "./recovery/failure-detector.js";
import { attemptDomRepair } from "./recovery/locator-repair.js";
import { VisionAnalyzer } from "./recovery/vision-analyzer.js";
import { combineConfidence, AUTO_SAVE_THRESHOLD, ACCEPT_THRESHOLD } from "./recovery/confidence.js";
import { siteKeyFor } from "./storage/rules-repository.js";
import { parseValue } from "./extraction/parsers.js";
const DEFAULT_USER_AGENT = "SelfHealingScraper/1.0 (+https://example.invalid/bot)";
export class Scraper {
    db;
    browserOptions;
    respectRobots;
    maxAttempts;
    vision;
    constructor(options) {
        this.db = options.db;
        this.browserOptions = {
            userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
            allowPrivateNetwork: options.allowPrivateNetwork ?? false,
            executablePath: options.chromiumPath,
            launchArgs: options.chromiumArgs,
        };
        this.respectRobots = options.respectRobots ?? true;
        this.maxAttempts = options.maxRecoveryAttemptsPerField ?? 2;
        this.vision = options.vision ?? new VisionAnalyzer({});
    }
    async scrape(url, config) {
        const start = Date.now();
        const siteKey = siteKeyFor(url);
        const jobId = this.db.startJob(url, siteKey);
        try {
            if (this.respectRobots) {
                const robots = await checkRobotsAllowed(url, this.browserOptions.userAgent, this.browserOptions.allowPrivateNetwork);
                if (!robots.allowed) {
                    const result = this.fail(url, `Blocked by robots.txt: ${robots.detail}`, start);
                    this.db.finishJob(jobId, "failed", result.durationMs, result.error);
                    return result;
                }
            }
            const session = await openSession(url, this.browserOptions);
            try {
                await navigate(session, url);
                const html = await captureHtml(session.page);
                const ctx = parseHtml(html, session.page.url());
                const fields = {};
                const repairs = [];
                const jsonldTypes = config.jsonldTypes ?? ["Product"];
                for (const field of config.fields) {
                    const savedRule = this.db.getRule(siteKey, field.name);
                    const firstPass = resolveField(ctx, field, savedRule, jsonldTypes);
                    const diagnosis = detectFailure(field, firstPass);
                    if (!diagnosis) {
                        fields[field.name] = {
                            field: field.name,
                            status: "ok",
                            value: firstPass.value,
                            strategy: firstPass.strategy,
                            selector: firstPass.selector,
                            attr: firstPass.attr,
                            confidence: firstPass.confidence,
                            evidence: `Matched via ${firstPass.strategy} (${firstPass.selector ?? "n/a"}).`,
                            warnings: firstPass.warnings,
                        };
                        continue;
                    }
                    const repair = await this.repairField(ctx, session, field, diagnosis, siteKey);
                    repairs.push(repair.record);
                    fields[field.name] = repair.result;
                }
                const { data, validationErrors } = this.assemble(config, fields);
                const unresolved = Object.values(fields)
                    .filter((f) => f.status === "unresolved")
                    .map((f) => f.field);
                const status = validationErrors.length > 0 ? "failed" : unresolved.length > 0 ? "partial" : "success";
                const result = {
                    url: session.page.url(),
                    status,
                    data: validationErrors.length > 0 ? null : data,
                    fields,
                    unresolved,
                    repairs,
                    validationErrors,
                    durationMs: Date.now() - start,
                };
                for (const f of Object.values(fields)) {
                    this.db.recordFieldResult(jobId, f.field, f.status, f.value, f.strategy, f.selector, f.confidence);
                }
                for (const r of repairs)
                    this.db.recordRepair(jobId, r);
                this.db.finishJob(jobId, status, result.durationMs);
                return result;
            }
            finally {
                await session.close();
            }
        }
        catch (err) {
            const result = this.fail(url, err instanceof Error ? err.message : String(err), start);
            this.db.finishJob(jobId, "failed", result.durationMs, result.error);
            return result;
        }
    }
    fail(url, error, start) {
        return {
            url,
            status: "failed",
            data: null,
            fields: {},
            unresolved: [],
            repairs: [],
            validationErrors: [],
            error,
            durationMs: Date.now() - start,
        };
    }
    async repairField(ctx, session, field, firstDiagnosis, siteKey) {
        if (!firstDiagnosis)
            throw new Error("repairField called without a diagnosis");
        let domOutcome = attemptDomRepair(ctx, field, firstDiagnosis);
        let visionConfidence = 0;
        let visionDetail = "Vision recovery not attempted.";
        let visionValue;
        let visionSelector;
        let visionAttr;
        let visionStable = false;
        let attempts = 1;
        while (domOutcome.status !== "resolved" && attempts < this.maxAttempts && field.required && this.vision.available) {
            attempts += 1;
            const screenshot = await captureScreenshot(session.page);
            const boxes = await captureCandidateBoxes(session.page, field.hints.length ? field.hints : [field.name], {
                includeCurrencyText: field.kind === "price",
            });
            const answer = await this.vision.analyze({
                screenshotPngBase64: screenshot.toString("base64"),
                boxes,
                fieldDescription: field.description,
                fieldName: field.name,
            });
            visionConfidence = answer.confidence;
            visionDetail = answer.reason;
            if (answer.idx !== null) {
                const box = boxes[answer.idx];
                if (box) {
                    const point = await locateElementAt(session.page, box.x + box.width / 2, box.y + box.height / 2);
                    if (point?.selector) {
                        const parsed = parseValue(field.kind, point.text, ctx.pageUrl);
                        if (parsed !== null) {
                            visionValue = parsed;
                            visionSelector = point.selector;
                            visionAttr = point.attr;
                            visionStable = point.stable;
                        }
                    }
                }
            }
            break;
        }
        const domHasValue = domOutcome.status === "resolved";
        const agree = domHasValue && visionValue !== undefined
            ? String(domOutcome.value) === String(visionValue) || Math.abs(Number(domOutcome.value) - Number(visionValue)) < 0.01
            : false;
        const finalValue = domHasValue ? domOutcome.value : visionValue;
        const finalSelector = domHasValue ? domOutcome.selector : visionSelector;
        const finalAttr = domHasValue ? domOutcome.attr : visionAttr;
        const method = domHasValue ? "dom" : visionValue !== undefined ? "vision" : "none";
        const confidence = finalValue === undefined ? 0 : combineConfidence(domHasValue ? domOutcome.confidence : 0, visionConfidence, agree);
        const success = finalValue !== undefined && confidence >= ACCEPT_THRESHOLD;
        const record = {
            field: field.name,
            reason: firstDiagnosis.reason,
            method,
            success,
            attempts,
            selector: finalSelector,
            previousSelector: firstDiagnosis.candidates.find((c) => c.selector)?.selector,
            value: finalValue,
            confidence,
            detail: success
                ? `Repaired via ${method}${agree ? " (confirmed by both DOM and vision)" : ""}. ${visionDetail}`.trim()
                : `Could not repair. DOM: ${domOutcome.status}. Vision: ${visionDetail}`,
        };
        if (success && finalSelector && confidence >= AUTO_SAVE_THRESHOLD) {
            this.db.saveRule({
                siteKey,
                field: field.name,
                selector: finalSelector,
                attr: finalAttr,
                confidence,
                source: method === "vision" ? "vision-repair" : "dom-repair",
                lastValue: finalValue,
            });
        }
        if (success) {
            return { record, result: {
                    field: field.name,
                    status: "repaired",
                    value: finalValue,
                    strategy: method === "vision" ? "vision-repair" : "dom-repair",
                    selector: finalSelector,
                    attr: finalAttr,
                    confidence,
                    evidence: record.detail,
                    warnings: [...domOutcome.warnings, ...(visionStable ? [] : visionValue !== undefined ? ["Vision located an unstable selector."] : [])],
                } };
        }
        if (field.defaultValue !== undefined) {
            return { record, result: {
                    field: field.name,
                    status: "defaulted",
                    value: field.defaultValue,
                    confidence: 0,
                    evidence: `No reliable match found; used the configured default value. ${record.detail}`,
                    warnings: [...domOutcome.warnings, "Used default value."],
                } };
        }
        return { record, result: {
                field: field.name,
                status: "unresolved",
                confidence,
                evidence: record.detail,
                warnings: domOutcome.warnings,
            } };
    }
    assemble(config, fields) {
        const data = {};
        for (const [name, result] of Object.entries(fields)) {
            if (result.value !== undefined)
                data[name] = result.value;
        }
        const parsed = config.schema.safeParse(data);
        if (parsed.success)
            return { data: parsed.data, validationErrors: [] };
        const requiredMissing = config.fields
            .filter((f) => f.required && fields[f.name]?.status === "unresolved")
            .map((f) => `Required field "${f.name}" could not be resolved.`);
        if (requiredMissing.length > 0) {
            return { data, validationErrors: requiredMissing };
        }
        const zodErrors = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
        return { data, validationErrors: zodErrors };
    }
}
//# sourceMappingURL=scraper.js.map
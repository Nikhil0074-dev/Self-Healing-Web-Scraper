import { chromium } from "playwright";
import { checkUrlSafety } from "../security/ssrf.js";
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RESOURCE_BYTES = 25 * 1024 * 1024;
/**
 * Launches a locked-down browser session: blocks navigation and redirects to private networks,
 * blocks media/font downloads to save bandwidth, and caps response size.
 */
export async function openSession(url, options) {
    const initialCheck = await checkUrlSafety(url, { allowPrivate: options.allowPrivateNetwork });
    if (!initialCheck.ok)
        throw new Error(`Refusing to navigate: ${initialCheck.reason}`);
    const browser = await chromium.launch({
        headless: true,
        executablePath: options.executablePath,
        args: options.launchArgs,
    });
    const context = await browser.newContext({
        userAgent: options.userAgent,
        javaScriptEnabled: true,
        viewport: { width: 1366, height: 900 },
    });
    context.on("page", () => void 0);
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(options.navigationTimeoutMs ?? DEFAULT_TIMEOUT_MS);
    page.setDefaultTimeout(options.navigationTimeoutMs ?? DEFAULT_TIMEOUT_MS);
    await page.route("**/*", async (route) => {
        const request = route.request();
        const type = request.resourceType();
        if (type === "media" || type === "font") {
            await route.abort();
            return;
        }
        const target = request.url();
        const check = await checkUrlSafety(target, { allowPrivate: options.allowPrivateNetwork });
        if (!check.ok) {
            await route.abort();
            return;
        }
        await route.continue();
    });
    const close = async () => {
        await context.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
    };
    return { browser, context, page, close };
}
/** Navigates and waits for the page to settle, enforcing a byte budget on the main document. */
export async function navigate(session, url) {
    const response = await session.page.goto(url, { waitUntil: "domcontentloaded" });
    if (response) {
        const lengthHeader = response.headers()["content-length"];
        if (lengthHeader && Number.isFinite(Number(lengthHeader)) && Number(lengthHeader) > MAX_RESOURCE_BYTES) {
            throw new Error("Page exceeds the maximum allowed size.");
        }
        const pageHtmlBytes = Buffer.byteLength(await session.page.content(), "utf8");
        if (pageHtmlBytes > MAX_RESOURCE_BYTES) {
            throw new Error("Page exceeds the maximum allowed size.");
        }
    }
    await session.page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
    return { status: response?.status() ?? null };
}
//# sourceMappingURL=launch.js.map
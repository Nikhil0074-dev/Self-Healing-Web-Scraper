import chromiumBinary from "@sparticuz/chromium";
import { existsSync } from "node:fs";
import { join } from "node:path";

function installedWindowsChromium(): string | undefined {
  const roots = [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"]].filter(
    (root): root is string => Boolean(root)
  );
  const candidates = roots.flatMap((root) => [
    join(root, "ms-playwright", "chromium-1228", "chrome-win64", "chrome.exe"),
    join(root, "Google", "Chrome", "Application", "chrome.exe"),
    join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
  ]);
  return candidates.find((candidate) => existsSync(candidate));
}

/**
 * In most environments Playwright's own bundled Chromium is used (leave env vars unset).
 * This sandbox cannot reach the Playwright CDN, so tests fall back to the @sparticuz/chromium
 * binary via SCRAPER_CHROMIUM_PATH/SCRAPER_CHROMIUM_ARGS, exactly the override path real users
 * would use on a locked-down server. Nothing in production code is sandbox-specific.
 */
export async function resolveTestChromium(): Promise<{ executablePath?: string; args?: string[] }> {
  const configured = process.env["SCRAPER_CHROMIUM_PATH"];
  if (configured && existsSync(configured)) {
    return {
      executablePath: configured,
      args: process.env["SCRAPER_CHROMIUM_ARGS"]?.split(" ").filter(Boolean),
    };
  }
  if (process.platform === "win32") {
    const installed = installedWindowsChromium();
    if (installed) return { executablePath: installed };
    return {};
  }
  try {
    const executablePath = await chromiumBinary.executablePath();
    return { executablePath, args: chromiumBinary.args };
  } catch {
    return {};
  }
}

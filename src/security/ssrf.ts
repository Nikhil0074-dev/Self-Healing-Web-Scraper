import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Blocks loopback, private, link-local, multicast and other non-public ranges, including IPv4-in-IPv6. */
export function isPrivateAddress(address: string): boolean {
  let addr = address;
  if (addr.startsWith("::ffff:")) addr = addr.slice(7);

  if (isIP(addr) === 4) {
    const [a, b] = addr.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 incl. 192.0.0.192 metadata alias
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  if (isIP(addr) === 6) {
    const lower = addr.toLowerCase();
    if (lower === "::1") return true;
    if (lower.startsWith("fe80:")) return true; // link-local
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
    if (lower.startsWith("::")) return true;
    return false;
  }

  return true; // not a literal IP: treat as unresolved/unknown, caller resolves via DNS first
}

export interface UrlCheckOptions {
  allowPrivate: boolean;
}

export interface UrlCheckResult {
  ok: boolean;
  reason?: string;
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

/** Validates scheme, hostname and the resolved IP before Playwright is allowed to navigate there. */
export async function checkUrlSafety(rawUrl: string, options: UrlCheckOptions): Promise<UrlCheckResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `Scheme "${url.protocol}" is not allowed. Use http or https.` };
  }
  if (!url.hostname) return { ok: false, reason: "URL must include a hostname." };
  if (url.username || url.password) {
    return { ok: false, reason: "URLs with embedded credentials are not allowed." };
  }
  if (options.allowPrivate) return { ok: true };

  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    return { ok: false, reason: `Host "${hostname}" is blocked.` };
  }
  if (isIP(hostname) && isPrivateAddress(hostname)) {
    return { ok: false, reason: `IP address "${hostname}" is a private or reserved address.` };
  }

  try {
    const records = await lookup(hostname, { all: true });
    const blocked = records.find((r) => isPrivateAddress(r.address));
    if (blocked) {
      return { ok: false, reason: `Host "${hostname}" resolves to a private address (${blocked.address}).` };
    }
  } catch {
    return { ok: false, reason: `Could not resolve host "${hostname}".` };
  }

  return { ok: true };
}

/** Re-check applied to every redirect hop, since a safe start URL can redirect to an internal address. */
export async function assertRedirectSafe(url: string, options: UrlCheckOptions): Promise<void> {
  const result = await checkUrlSafety(url, options);
  if (!result.ok) throw new Error(`Blocked redirect to unsafe URL: ${result.reason}`);
}

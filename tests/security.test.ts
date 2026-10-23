import { describe, it, expect } from "vitest";
import { isPrivateAddress, checkUrlSafety } from "../src/security/ssrf.js";
import { parseRobots, isPathAllowed } from "../src/security/robots.js";

describe("isPrivateAddress", () => {
  it("blocks loopback", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::1")).toBe(true);
  });
  it("blocks RFC1918 private ranges", () => {
    expect(isPrivateAddress("10.0.0.5")).toBe(true);
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
  });
  it("blocks the cloud metadata address", () => {
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
  });
  it("blocks link-local IPv6", () => {
    expect(isPrivateAddress("fe80::1")).toBe(true);
  });
  it("allows a normal public IPv4 address", () => {
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
  });
  it("allows a normal public IPv6 address", () => {
    expect(isPrivateAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(false);
  });
});

describe("checkUrlSafety", () => {
  it("rejects file:// scheme", async () => {
    const result = await checkUrlSafety("file:///etc/passwd", { allowPrivate: false });
    expect(result.ok).toBe(false);
  });

  it("rejects an embedded-credentials URL", async () => {
    const result = await checkUrlSafety("https://user:pass@example.com", { allowPrivate: false });
    expect(result.ok).toBe(false);
  });

  it("rejects a literal private IP target", async () => {
    const result = await checkUrlSafety("http://127.0.0.1:9999/", { allowPrivate: false });
    expect(result.ok).toBe(false);
  });

  it("rejects localhost by name", async () => {
    const result = await checkUrlSafety("http://localhost/", { allowPrivate: false });
    expect(result.ok).toBe(false);
  });

  it("allows a private target when explicitly opted in (trusted dev mode)", async () => {
    const result = await checkUrlSafety("http://127.0.0.1:9999/", { allowPrivate: true });
    expect(result.ok).toBe(true);
  });

  it("rejects malformed URLs", async () => {
    const result = await checkUrlSafety("not a url at all", { allowPrivate: false });
    expect(result.ok).toBe(false);
  });
});

describe("robots.txt parsing", () => {
  const text = [
    "User-agent: *",
    "Disallow: /private/",
    "Allow: /private/public-page",
    "",
    "User-agent: BadBot",
    "Disallow: /",
  ].join("\n");

  it("builds rules for the matching user agent group only", () => {
    const rules = parseRobots(text, "SelfHealingScraper/1.0");
    expect(rules).toEqual([
      { allow: false, path: "/private/" },
      { allow: true, path: "/private/public-page" },
    ]);
  });

  it("disallows a path under a disallowed prefix", () => {
    const rules = parseRobots(text, "SelfHealingScraper/1.0");
    expect(isPathAllowed(rules, "/private/secret")).toBe(false);
  });

  it("allows a more specific Allow rule to override a broader Disallow", () => {
    const rules = parseRobots(text, "SelfHealingScraper/1.0");
    expect(isPathAllowed(rules, "/private/public-page")).toBe(true);
  });

  it("allows paths with no matching rule", () => {
    const rules = parseRobots(text, "SelfHealingScraper/1.0");
    expect(isPathAllowed(rules, "/products/headphones")).toBe(true);
  });

  it("returns no rules when robots.txt has no matching group", () => {
    const rules = parseRobots("User-agent: OtherBot\nDisallow: /", "SelfHealingScraper/1.0");
    expect(rules).toEqual([]);
  });
});

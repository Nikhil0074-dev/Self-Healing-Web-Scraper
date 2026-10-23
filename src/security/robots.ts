import { checkUrlSafety } from "./ssrf.js";

interface RobotsRule {
  allow: boolean;
  path: string;
}

/** Minimal robots.txt parser: enough to honor Disallow/Allow for a single user agent. */
export function parseRobots(text: string, userAgent: string): RobotsRule[] {
  const wanted = userAgent.toLowerCase().split(/[\s/()+]+/).filter(Boolean)[0] ?? "";
  const groups: { agents: string[]; rules: RobotsRule[] }[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | undefined;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) {
      current = undefined;
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (!current || current.rules.length > 0) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && key === "disallow" && value) {
      current.rules.push({ allow: false, path: value });
    } else if (current && key === "allow" && value) {
      current.rules.push({ allow: true, path: value });
    }
  }

  const matching = groups.filter((group) => group.agents.some((agent) =>
    agent === "*" || wanted === agent || wanted.startsWith(`${agent}/`)
  ));
  const specific = matching.filter((group) => !group.agents.includes("*"));
  return (specific.length > 0 ? specific : matching).flatMap((group) => group.rules);
}

export function isPathAllowed(rules: RobotsRule[], path: string): boolean {
  let best: RobotsRule | null = null;
  for (const rule of rules) {
    if (path.startsWith(rule.path) && (!best || rule.path.length > best.path.length)) best = rule;
  }
  return best ? best.allow : true;
}

/** Fetches and checks robots.txt for the target URL. Fails open (allowed) if robots.txt cannot be fetched. */
export async function checkRobotsAllowed(
  targetUrl: string,
  userAgent: string,
  allowPrivate: boolean
): Promise<{ allowed: boolean; detail: string }> {
  const url = new URL(targetUrl);
  const robotsUrl = `${url.protocol}//${url.host}/robots.txt`;
  const safety = await checkUrlSafety(robotsUrl, { allowPrivate });
  if (!safety.ok) return { allowed: false, detail: `robots.txt URL blocked: ${safety.reason}` };

  try {
    const res = await fetch(robotsUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { allowed: true, detail: "No robots.txt found; proceeding." };
    const text = await res.text();
    const rules = parseRobots(text, userAgent);
    const allowed = isPathAllowed(rules, url.pathname);
    return { allowed, detail: allowed ? "Allowed by robots.txt." : "Disallowed by robots.txt." };
  } catch {
    return { allowed: true, detail: "robots.txt unreachable; proceeding." };
  }
}

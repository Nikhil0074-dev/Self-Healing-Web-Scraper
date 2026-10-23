import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize } from "node:path";

export interface FixtureServer {
  url: string;
  close: () => Promise<void>;
}

/** Serves tests/fixtures/*.html over plain HTTP on localhost so Playwright can navigate to it like a real site. */
export async function startFixtureServer(fixturesDir: string): Promise<FixtureServer> {
  const server: Server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(req.url?.split("?")[0] ?? "/"));
    if (path.includes("..")) {
      res.writeHead(400).end("bad path");
      return;
    }
    const filePath = join(fixturesDir, path === "/" ? "/index.html" : path);
    readFile(filePath)
      .then((buf) => {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(buf);
      })
      .catch(() => {
        res.writeHead(404).end("not found");
      });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

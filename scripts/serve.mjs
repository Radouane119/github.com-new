#!/usr/bin/env node
// Minimal static server for local smoke tests. The shipped dashboard has no
// runtime server; this only serves the committed files over HTTP so Playwright
// can exercise service-worker-free page loads.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 4173);

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent((request.url || "/").split("?")[0]);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const file = normalize(join(root, relative));

  if (file !== root && !file.startsWith(root.endsWith(sep) ? root : root + sep)) {
    response.writeHead(403, { "content-type": "text/plain" }).end("forbidden");
    return;
  }

  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("not a file");
    response.writeHead(200, {
      "content-type": types[extname(file)] || "application/octet-stream",
      "cache-control": "no-store",
      "content-length": info.size,
    });
    createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { "content-type": "text/plain" }).end("not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`serving ${root} at http://127.0.0.1:${port}/`);
});

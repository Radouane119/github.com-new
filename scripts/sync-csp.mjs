#!/usr/bin/env node
// Recompute the CSP script hash after editing the inline script.
// Usage: node scripts/sync-csp.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const file = new URL("../index.html", import.meta.url);
const html = readFileSync(file, "utf8");

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  console.error("sync-csp: no inline <script> block found");
  process.exit(1);
}

// Browsers normalise CRLF/CR to LF before hashing inline script text.
const scriptText = scriptMatch[1].replace(/\r\n?/g, "\n");
const hash = `sha256-${createHash("sha256").update(scriptText, "utf8").digest("base64")}`;
const cspRe = /(<meta http-equiv="Content-Security-Policy" content="[^"]*?script-src )'sha256-[^']*'/i;

if (!cspRe.test(html)) {
  console.error("sync-csp: CSP meta tag with script-src 'sha256-...' not found");
  process.exit(1);
}

writeFileSync(file, html.replace(cspRe, `$1'${hash}'`), "utf8");
console.log(`sync-csp: ${hash}`);

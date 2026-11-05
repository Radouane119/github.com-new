#!/usr/bin/env node
// Static guardrails for the single-file app. Runs without a browser or network:
//   1. the inline script must parse;
//   2. the bootstrap entry point must still exist;
//   3. the CSP hash must match the inline script exactly;
//   4. no inline event handlers may sneak back in (they are blocked by CSP).
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const html = readFileSync(new URL("index.html", root), "utf8");

const failures = [];
const fail = (message) => failures.push(message);

const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
if (!scriptMatch) {
  fail("no inline <script> block found in index.html");
} else {
  const js = scriptMatch[1];

  try {
    new vm.Script(js, { filename: "index-inline.js" });
  } catch (error) {
    fail(`inline script does not compile: ${error.message}`);
  }

  if (!js.includes("\nloadHistory();")) {
    fail("bootstrap marker \"\\nloadHistory();\" is missing");
  }

  if (/\beval\s*\(|new\s+Function\s*\(/.test(js)) {
    fail("inline script uses eval() or new Function(), which a strict CSP would block");
  }

  // Browsers normalise CRLF/CR to LF before hashing inline script text.
  const scriptText = js.replace(/\r\n?/g, "\n");
  const hash = `sha256-${createHash("sha256").update(scriptText, "utf8").digest("base64")}`;
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"/i);
  if (!csp) {
    fail("Content-Security-Policy meta tag is missing");
  } else if (!csp[1].includes(`script-src '${hash}'`)) {
    fail(
      "CSP script hash is stale.\n" +
        `  expected: script-src '${hash}'\n` +
        "  run: node scripts/sync-csp.mjs"
    );
  }
}

const handlers = [...html.matchAll(/\son[a-z]+\s*=\s*"/gi)].map((m) => m[0].trim());
if (handlers.length > 0) {
  fail(`inline event handler(s) found (blocked by CSP): ${[...new Set(handlers)].join(", ")}`);
}

if (failures.length > 0) {
  console.error("verify-html: FAIL");
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log("verify-html: OK");

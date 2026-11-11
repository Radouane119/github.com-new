#!/usr/bin/env node
// Guardrails for the generated service worker: its cache name must track the
// committed index.html, its precache list must point at real files, and the
// network-first navigation path must survive regeneration.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const failures = [];
const fail = (message) => failures.push(message);

const read = (name) => readFileSync(new URL(name, root), "utf8").replace(/\r\n?/g, "\n");

let html;
let sw;
try {
  html = read("index.html");
  sw = read("sw.js");
} catch (error) {
  console.error("verify-sw: FAIL");
  console.error(`  - cannot read generated files: ${error.message}`);
  process.exit(1);
}

try {
  new vm.Script(sw, { filename: "sw.js" });
} catch (error) {
  fail(`sw.js does not parse: ${error.message}`);
}

const expectedCache = `signals-${createHash("sha256").update(html, "utf8").digest("hex").slice(0, 12)}`;
const cacheMatch = sw.match(/const CACHE = "([^"]+)";/);
if (!cacheMatch) {
  fail("sw.js does not declare const CACHE");
} else if (cacheMatch[1] !== expectedCache) {
  fail(`cache name ${cacheMatch[1]} does not match index.html (${expectedCache})`);
}

const assetsMatch = sw.match(/const ASSETS = (\[[^\]]*\]);/);
if (!assetsMatch) {
  fail("sw.js does not declare const ASSETS");
} else {
  let assets;
  try {
    assets = JSON.parse(assetsMatch[1]);
  } catch (error) {
    fail(`ASSETS is not valid JSON: ${error.message}`);
  }
  if (Array.isArray(assets)) {
    for (const asset of ["./", "./index.html", "./manifest.json", "./icon.svg"]) {
      if (!assets.includes(asset)) fail(`ASSETS is missing ${asset}`);
    }
    for (const asset of assets) {
      const file = asset === "./" ? "index.html" : String(asset).replace(/^\.\//, "");
      if (!existsSync(new URL(file, root))) fail(`ASSETS points at a missing file: ${asset}`);
    }
  }
}

if (!/event\.request\.mode === "navigate"/.test(sw)) {
  fail("sw.js no longer treats navigations separately");
}
if (!/fetch\(event\.request\)[\s\S]*caches\.match\("\.\/index\.html"\)/.test(sw)) {
  fail("sw.js navigation path is no longer network-first with an offline cache fallback");
}
if (/\{\{[A-Z_]+\}\}/.test(sw)) {
  fail("sw.js still contains an unresolved placeholder");
}

if (failures.length > 0) {
  console.error("verify-sw: FAIL");
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log(`verify-sw: OK (${expectedCache})`);

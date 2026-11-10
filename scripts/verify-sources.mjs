#!/usr/bin/env node
// Guardrails for the split JavaScript sources: the manifest must list every
// src/app/*.js exactly once, and each file must parse as a standalone script.
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const appDir = new URL("src/app/", root);

const failures = [];
const fail = (message) => failures.push(message);

let manifest;
try {
  manifest = JSON.parse(readFileSync(new URL("src/app/manifest.json", root), "utf8"));
} catch (error) {
  console.error("verify-sources: FAIL");
  console.error(`  - cannot read src/app/manifest.json: ${error.message}`);
  process.exit(1);
}

if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
  fail('src/app/manifest.json must contain a non-empty "files" array');
} else {
  const seen = new Set();
  for (const name of manifest.files) {
    if (typeof name !== "string" || !/^[0-9a-z-]+\.js$/i.test(name)) {
      fail(`invalid source name: ${JSON.stringify(name)}`);
      continue;
    }
    if (seen.has(name)) {
      fail(`duplicate source in manifest: ${name}`);
      continue;
    }
    seen.add(name);

    let text;
    try {
      text = readFileSync(new URL(name, appDir), "utf8");
    } catch {
      fail(`missing source: ${name}`);
      continue;
    }
    if (text.trim() === "") {
      fail(`empty source: ${name}`);
      continue;
    }
    try {
      new vm.Script(text, { filename: name });
    } catch (error) {
      fail(`${name} does not parse: ${error.message}`);
    }
  }

  for (const name of readdirSync(appDir)) {
    if (name.endsWith(".js") && !seen.has(name)) {
      fail(`source not listed in manifest: ${name}`);
    }
  }
}

if (failures.length > 0) {
  console.error("verify-sources: FAIL");
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log(`verify-sources: OK (${manifest.files.length} files)`);

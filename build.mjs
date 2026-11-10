#!/usr/bin/env node
// Reproducible build for the single-file dashboard.
//
// Source of truth:
//   src/index.template.html  page shell with {{STYLES}}, {{SCRIPT}}, {{CSP_HASH}}
//   src/styles.css           inline CSS
//   src/app/manifest.json    ordered list of JavaScript sources
//   src/app/*.js             inline JavaScript, concatenated in manifest order
//
// Generated artifact:
//   index.html               committed, so the site keeps working from file://
//                            and GitHub Pages with no build step at deploy time.
//
// Usage:
//   node build.mjs            regenerate index.html
//   node build.mjs --check    fail when index.html differs from the sources
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const root = new URL("./", import.meta.url);

function read(name) {
  // Normalise line endings so the build is identical on Windows and Linux.
  return readFileSync(new URL(name, root), "utf8").replace(/\r\n?/g, "\n");
}

export function hashScript(script) {
  return `sha256-${createHash("sha256").update(script, "utf8").digest("base64")}`;
}

function readApp() {
  const manifest = JSON.parse(read("src/app/manifest.json"));
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("build: src/app/manifest.json must list at least one file");
  }
  return manifest.files.map((name) => read(`src/app/${name}`)).join("");
}

export function render() {
  const template = read("src/index.template.html");
  const styles = read("src/styles.css");
  const app = readApp();

  const shell = template
    .replace("{{STYLES}}", () => styles)
    .replace("{{SCRIPT}}", () => app);

  // Hash the exact text the browser sees between <script> and </script>,
  // including the newline the template leaves before the script body.
  const scriptMatch = shell.match(/<script>([\s\S]*?)<\/script>/);
  if (!scriptMatch) throw new Error("build: no inline <script> block in template");
  const hash = hashScript(scriptMatch[1]);

  const html = shell.replace("{{CSP_HASH}}", () => hash);

  for (const marker of ["{{CSP_HASH}}", "{{STYLES}}", "{{SCRIPT}}"]) {
    if (html.includes(marker)) throw new Error(`build: unresolved placeholder ${marker}`);
  }

  return { html, hash };
}

export function writeBuild() {
  const result = render();
  writeFileSync(new URL("index.html", root), result.html, "utf8");
  return result;
}

function firstDifference(expected, actual) {
  const expectedLines = expected.split("\n");
  const actualLines = actual.split("\n");
  const count = Math.max(expectedLines.length, actualLines.length);
  for (let index = 0; index < count; index += 1) {
    if (expectedLines[index] !== actualLines[index]) {
      return { line: index + 1, expected: expectedLines[index], actual: actualLines[index] };
    }
  }
  return null;
}

function main(argv) {
  const check = argv.includes("--check");

  if (!check) {
    const { hash } = writeBuild();
    console.log(`build: wrote index.html (${hash})`);
    return;
  }

  const { html, hash } = render();
  let current = null;
  try {
    current = read("index.html");
  } catch {
    current = null;
  }

  if (current === html) {
    console.log(`build: index.html is up to date (${hash})`);
    return;
  }

  console.error("build: index.html is out of date — run `node build.mjs`");
  if (current === null) {
    console.error("  index.html is missing");
  } else {
    const diff = firstDifference(html, current);
    if (diff) {
      console.error(`  first difference at line ${diff.line}`);
      console.error(`    expected: ${diff.expected}`);
      console.error(`    actual:   ${diff.actual}`);
    }
  }
  process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main(process.argv.slice(2));

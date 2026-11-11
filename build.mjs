#!/usr/bin/env node
// Reproducible build for the single-file dashboard.
//
// Source of truth:
//   src/index.template.html  page shell with {{STYLES}}, {{SCRIPT}}, {{CSP_HASH}}
//   src/styles.css           inline CSS
//   src/app/manifest.json    ordered list of JavaScript sources
//   src/app/*.js             JavaScript bundled by esbuild in manifest order
//   src/sw.template.js       service worker with {{CACHE}} and {{ASSETS}}
//
// Generated artifacts:
//   index.html               committed, so the site keeps working from file://
//                            and GitHub Pages with no build step at deploy time.
//   sw.js                    cache name derived from index.html, assets verified
//
// Usage:
//   node build.mjs            regenerate index.html and sw.js
//   node build.mjs --check    fail when either file differs from the sources
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { buildSync } from "esbuild";

const root = new URL("./", import.meta.url);

function read(name) {
  // Normalise line endings so the build is identical on Windows and Linux.
  return readFileSync(new URL(name, root), "utf8").replace(/\r\n?/g, "\n");
}

export function hashScript(script) {
  return `sha256-${createHash("sha256").update(script, "utf8").digest("base64")}`;
}

// Static files the worker precaches. The list is verified against disk on every
// build, and the cache name is derived from the generated index.html so a deploy
// can never reuse a stale cache.
const SW_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
];

function renderServiceWorker(html) {
  for (const asset of SW_ASSETS) {
    const file = asset === "./" ? "index.html" : asset.replace(/^\.\//, "");
    if (!existsSync(new URL(file, root))) {
      throw new Error(`build: service worker asset is missing: ${asset}`);
    }
  }

  const version = createHash("sha256").update(html, "utf8").digest("hex").slice(0, 12);
  const cache = `signals-${version}`;
  const template = read("src/sw.template.js");
  const sw = template
    .replace("{{CACHE}}", () => cache)
    .replace("{{ASSETS}}", () => JSON.stringify(SW_ASSETS));

  for (const marker of ["{{CACHE}}", "{{ASSETS}}"]) {
    if (sw.includes(marker)) throw new Error(`build: unresolved placeholder ${marker} in service worker`);
  }

  return { sw, cache };
}

function readApp() {
  const manifest = JSON.parse(read("src/app/manifest.json"));
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("build: src/app/manifest.json must list at least one file");
  }
  return manifest.files.map((name) => read(`src/app/${name}`)).join("");
}

function bundleApp(app) {
  const result = buildSync({
    stdin: { contents: app, loader: "js", sourcefile: "dashboard.js" },
    bundle: true,
    format: "iife",
    target: "es2020",
    platform: "browser",
    charset: "utf8",
    legalComments: "none",
    write: false,
    logLevel: "silent",
  });
  return result.outputFiles[0].text;
}

export function render() {
  const template = read("src/index.template.html");
  const styles = read("src/styles.css");
  const app = bundleApp(readApp());

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

  const { sw, cache } = renderServiceWorker(html);

  return { html, hash, sw, cache };
}

export function writeBuild() {
  const result = render();
  writeFileSync(new URL("index.html", root), result.html, "utf8");
  writeFileSync(new URL("sw.js", root), result.sw, "utf8");
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
    const { hash, cache } = writeBuild();
    console.log(`build: wrote index.html (${hash})`);
    console.log(`build: wrote sw.js (${cache})`);
    return;
  }

  const { html, hash, sw, cache } = render();
  const outputs = [
    { name: "index.html", expected: html },
    { name: "sw.js", expected: sw },
  ];

  let stale = false;
  for (const output of outputs) {
    let current = null;
    try {
      current = read(output.name);
    } catch {
      current = null;
    }

    if (current === output.expected) continue;
    stale = true;
    console.error(`build: ${output.name} is out of date — run \`node build.mjs\``);
    if (current === null) {
      console.error(`  ${output.name} is missing`);
    } else {
      const diff = firstDifference(output.expected, current);
      if (diff) {
        console.error(`  first difference at line ${diff.line}`);
        console.error(`    expected: ${diff.expected}`);
        console.error(`    actual:   ${diff.actual}`);
      }
    }
  }

  if (stale) {
    process.exitCode = 1;
    return;
  }

  console.log(`build: index.html and sw.js are up to date (${hash}, ${cache})`);
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main(process.argv.slice(2));

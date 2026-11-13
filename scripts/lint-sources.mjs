#!/usr/bin/env node
// Lint the dashboard sources the way the browser runs them: as one classic
// script built from src/app/manifest.json order. Linting each file separately
// would flag every cross-file reference as undefined.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const root = new URL("../", import.meta.url);
const appDir = new URL("src/app/", root);

let manifest;
try {
  manifest = JSON.parse(readFileSync(new URL("manifest.json", appDir), "utf8"));
} catch (error) {
  console.error("lint-sources: FAIL");
  console.error(`  - cannot read src/app/manifest.json: ${error.message}`);
  process.exit(1);
}

if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
  console.error("lint-sources: FAIL");
  console.error('  - src/app/manifest.json must contain a non-empty "files" array');
  process.exit(1);
}

const parts = [];
const ranges = [];
let nextLine = 1;

for (const name of manifest.files) {
  let text;
  try {
    text = readFileSync(new URL(name, appDir), "utf8").replace(/\r\n?/g, "\n");
  } catch (error) {
    console.error("lint-sources: FAIL");
    console.error(`  - cannot read src/app/${name}: ${error.message}`);
    process.exit(1);
  }

  // The build joins sources without a separator. A trailing newline means the
  // next file starts on a new line; a missing one keeps it on the same line.
  const newlineCount = (text.match(/\n/g) || []).length;
  const endsWithNewline = text.endsWith("\n");
  const contentLines = newlineCount + (endsWithNewline ? 0 : 1);
  ranges.push({ name, start: nextLine, end: nextLine + contentLines - 1 });
  parts.push(text);
  nextLine += endsWithNewline ? contentLines : contentLines - 1;
}

const bundle = parts.join("");
const virtualPath = fileURLToPath(new URL("__lint-bundle__.js", appDir));

const eslint = new ESLint({
  cwd: fileURLToPath(root),
  overrideConfigFile: fileURLToPath(new URL("eslint.config.mjs", root)),
});

const sourceFor = (line) => {
  const range = ranges.find((entry) => line >= entry.start && line <= entry.end);
  return range
    ? { file: range.name, line: line - range.start + 1 }
    : { file: "(bundle)", line };
};

let errorCount = 0;
let warningCount = 0;

const report = (messages, locate) => {
  for (const message of messages) {
    const source = locate(message.line || 1);
    const location = `${source.file}:${source.line}:${message.column || 1}`;
    const severity = message.severity === 2 ? "error" : "warn";
    const rule = message.ruleId ? `  ${message.ruleId}` : "";
    console.log(`${location}  ${severity}  ${message.message}${rule}`);
    if (message.severity === 2) errorCount++;
    else warningCount++;
  }
};

const [bundleResult] = await eslint.lintText(bundle, {
  filePath: virtualPath,
  warnIgnored: false,
});
report(bundleResult.messages, sourceFor);

// The committed worker is generated, but build.mjs --check keeps it in sync, so
// linting the artifact covers the real runtime code without re-implementing the
// template placeholders.
const swText = readFileSync(new URL("sw.js", root), "utf8").replace(/\r\n?/g, "\n");
const [swResult] = await eslint.lintText(swText, {
  filePath: fileURLToPath(new URL("sw.js", root)),
  warnIgnored: false,
});
report(swResult.messages, (line) => ({ file: "sw.js", line }));

const summary =
  `${errorCount} error${errorCount === 1 ? "" : "s"}, ` +
  `${warningCount} warning${warningCount === 1 ? "" : "s"} ` +
  `across ${manifest.files.length} app sources and sw.js`;

if (errorCount > 0) {
  console.error(`lint-sources: FAIL (${summary})`);
  process.exit(1);
}

console.log(`lint-sources: OK (${summary})`);

#!/usr/bin/env node
// Guardrails for the installable PWA surface: manifest identity and icons,
// real PNG files with the advertised dimensions, and the links the document
// needs for Android, iOS and desktop installs.
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const failures = [];
const fail = (message) => failures.push(message);
const read = (name) => readFileSync(new URL(name, root), "utf8");

let manifest;
try {
  manifest = JSON.parse(read("manifest.json"));
} catch (error) {
  console.error("verify-pwa: FAIL");
  console.error(`  - manifest.json does not parse: ${error.message}`);
  process.exit(1);
}

const requiredStrings = ["id", "name", "short_name", "description", "lang", "start_url", "scope", "display", "background_color", "theme_color"];
for (const field of requiredStrings) {
  if (typeof manifest[field] !== "string" || manifest[field].trim() === "") {
    fail(`manifest.json is missing a non-empty ${field}`);
  }
}

for (const field of ["start_url", "scope"]) {
  if (typeof manifest[field] === "string" && !manifest[field].startsWith("./") && !manifest[field].startsWith("/")) {
    fail(`manifest.json ${field} must be relative to the manifest, got ${manifest[field]}`);
  }
}

if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
  fail("manifest.json lists no icons");
}

function pngSize(file) {
  const buffer = readFileSync(new URL(file, root));
  if (buffer.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") return null;
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
const bySpec = (size, purpose) =>
  icons.find((icon) => icon.sizes === size && String(icon.purpose || "any").split(/\s+/).includes(purpose));

const requiredIcons = [
  { size: "192x192", purpose: "any" },
  { size: "512x512", purpose: "any" },
  { size: "512x512", purpose: "maskable" },
];

for (const { size, purpose } of requiredIcons) {
  const icon = bySpec(size, purpose);
  if (!icon) {
    fail(`manifest.json has no ${size} ${purpose} icon`);
    continue;
  }
  if (icon.type !== "image/png") fail(`${icon.src} must be image/png, got ${icon.type}`);
  if (!existsSync(new URL(icon.src, root))) {
    fail(`manifest.json icon is missing on disk: ${icon.src}`);
    continue;
  }
  const dimensions = pngSize(icon.src);
  const [width, height] = size.split("x").map(Number);
  if (!dimensions || dimensions.width !== width || dimensions.height !== height) {
    fail(`${icon.src} is not a ${size} PNG (${dimensions ? `${dimensions.width}x${dimensions.height}` : "unreadable"})`);
  }
}

if (!icons.some((icon) => icon.type === "image/svg+xml")) {
  fail("manifest.json no longer offers the scalable SVG icon");
}

for (const icon of icons.filter((entry) => entry.type === "image/svg+xml")) {
  if (!existsSync(new URL(icon.src, root))) fail(`manifest.json icon is missing on disk: ${icon.src}`);
}

const maskable = bySpec("512x512", "maskable");
const any512 = bySpec("512x512", "any");
if (maskable && any512 && maskable.src === any512.src) {
  fail("the maskable icon must not reuse the transparent 'any' icon");
}

let html = "";
let template = "";
try {
  html = read("index.html");
  template = read("src/index.template.html");
} catch (error) {
  fail(`cannot read the page sources: ${error.message}`);
}

for (const [label, document] of [["index.html", html], ["src/index.template.html", template]]) {
  if (!/<link rel="manifest" href="manifest\.json">/.test(document)) fail(`${label} does not link the web app manifest`);
  if (!/<link rel="apple-touch-icon" href="icons\/apple-touch-icon\.png" sizes="180x180">/.test(document)) {
    fail(`${label} does not link a 180x180 apple-touch-icon`);
  }
  if (!/<meta name="theme-color" content="#0b1117">/.test(document)) fail(`${label} does not declare the theme colour`);
}

const appleIcon = "icons/apple-touch-icon.png";
if (!existsSync(new URL(appleIcon, root))) {
  fail(`the Apple touch icon is missing: ${appleIcon}`);
} else {
  const dimensions = pngSize(appleIcon);
  if (!dimensions || dimensions.width !== 180 || dimensions.height !== 180) {
    fail(`${appleIcon} is not a 180x180 PNG`);
  }
}

let sw = "";
try {
  sw = read("sw.js");
} catch (error) {
  fail(`cannot read sw.js: ${error.message}`);
}
const assetsMatch = sw.match(/const ASSETS = (\[[^\]]*\]);/);
if (!assetsMatch) {
  fail("sw.js does not declare const ASSETS");
} else {
  try {
    const assets = JSON.parse(assetsMatch[1]);
    for (const asset of ["./manifest.json", ...icons.map((icon) => `./${icon.src}`)]) {
      if (!assets.includes(asset)) fail(`sw.js does not precache ${asset}`);
    }
  } catch (error) {
    fail(`sw.js ASSETS is not valid JSON: ${error.message}`);
  }
}

if (failures.length > 0) {
  console.error("verify-pwa: FAIL");
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log(`verify-pwa: OK (${icons.length} icons, id ${manifest.id})`);

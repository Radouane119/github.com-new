#!/usr/bin/env node
// Deprecated alias for `node build.mjs`.
//
// The CSP hash is no longer patched into index.html by hand: it is derived from
// the inline script during the build. Edit src/app.js (or src/styles.css) and
// run `node build.mjs` instead.
import { writeBuild } from "../build.mjs";

const { hash } = writeBuild();
console.log(`sync-csp: ${hash}`);

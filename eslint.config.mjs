// ESLint flat config.
//
// The dashboard ships as one classic script built by concatenating
// src/app/*.js in manifest order. Linting those files individually would
// report every cross-file reference as undefined, so scripts/lint-sources.mjs
// feeds the concatenated program to ESLint through the virtual path below.
import js from "@eslint/js";
import globals from "globals";

export default [
  {
    name: "dashboard/ignores",
    ignores: ["node_modules/**", "icons/**", "index.html", "package-lock.json"],
  },
  {
    name: "dashboard/app-bundle",
    files: ["**/__lint-bundle__.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "warn",
    },
    rules: {
      ...js.configs.recommended.rules,
      // Undefined and duplicate declarations are always bugs.
      "no-redeclare": "error",
      "no-undef": "error",
      // Start as warnings so existing code can be cleaned up incrementally.
      "no-unused-vars": [
        "warn",
        {
          args: "none",
          caughtErrors: "none",
          varsIgnorePattern: "^_",
        },
      ],
      // `try { ... } catch {}` is an intentional pattern in this codebase.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    name: "dashboard/service-worker",
    files: ["sw.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.serviceworker,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];

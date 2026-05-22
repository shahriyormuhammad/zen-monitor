import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Allow _ prefix for intentionally unused variables and parameters.
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    // Claude Code git worktrees live under this folder and carry their own copies
    // of untracked helper scripts that we do not want to lint from main.
    ".claude/**",
    // Local utility and scratch scripts that are not part of the app/runtime lint baseline.
    "apply-all.js",
    "apply-rls.js",
    "seed-mock-data.js",
    "test.js",
    "test-query.js",
    // Throwaway inspection/debug scripts — not shipped, not linted.
    "tmp/**",
  ]),
]);

export default eslintConfig;

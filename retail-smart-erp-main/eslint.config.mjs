import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import noDirectRequestJson from "./eslint-rules/no-direct-request-json.js";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Allow underscore-prefixed unused variables (standard convention)
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        destructuredArrayIgnorePattern: "^_",
      }],
    },
  },
  // Custom rule: prevent direct request.json() in API routes
  {
    files: ["src/app/api/**/*.ts"],
    plugins: {
      "custom-rules": {
        rules: {
          "no-direct-request-json": noDirectRequestJson,
        },
      },
    },
    rules: {
      "custom-rules/no-direct-request-json": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated at build (CJS with require)
    "server.js",
    // Legacy CJS scripts (run with node, not ESM)
    "dark-mode-fix.js",
    "dark-mode-scan.js",
    "scripts/clone-production.js",
  ]),
]);

export default eslintConfig;

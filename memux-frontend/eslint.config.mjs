import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // Ported plasma tree: keep behavioural parity with the original code.
  // Plasma's eslint config didn't have these React-19-style rules, and the
  // patterns flagged below are correctness-neutral code-style preferences.
// Scoping the relaxation to src/memux/chat/** keeps the rest of memux-frontend
// under the strict ruleset.
  {
    files: ["src/memux/chat/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/exhaustive-deps": "off",
      "react/no-unescaped-entities": "off",
      "@next/next/no-img-element": "off",
      "@typescript-eslint/no-unused-vars": "warn",
    },
  },
]);

export default eslintConfig;

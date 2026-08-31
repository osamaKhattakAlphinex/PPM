import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

import {
  DAL_INTERNAL_FILES,
  restrictedDatabaseImports,
  restrictedModelCallSyntax,
} from "./eslint-rules/dal-boundary.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    // The data-isolation boundary. Everything under src/ must reach the
    // database through the DAL; only the DAL itself is exempt.
    files: ["src/**/*.{ts,tsx,js,jsx,mjs}"],
    ignores: DAL_INTERNAL_FILES,
    rules: {
      "no-restricted-syntax": ["error", ...restrictedModelCallSyntax],
      "no-restricted-imports": ["error", restrictedDatabaseImports],
    },
  },
];

export default eslintConfig;

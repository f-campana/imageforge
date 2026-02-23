import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import vitest from "eslint-plugin-vitest";
import globals from "globals";
import tseslint from "typescript-eslint";
import { fileURLToPath } from "node:url";
import path from "node:path";

const tsconfigRootDir = path.dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  {
    ignores: [
      "eslint.config.mjs",
      "dist/**",
      "node_modules/**",
      ".tmp/**",
      ".stryker-tmp/**",
      "tests/fixtures/**",
      "tests/cli-fixtures/**",
      "tests/test-output/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),
  {
    files: ["**/*.ts"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
      parserOptions: {
        project: "./tsconfig.typecheck.json",
        tsconfigRootDir,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
  {
    files: ["tests/**/*.ts"],
    plugins: {
      vitest,
    },
    languageOptions: {
      globals: {
        ...globals.node,
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
      },
    },
    rules: {
      ...vitest.configs.recommended.rules,
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        fetch: "readonly",
        URL: "readonly",
        Buffer: "readonly",
        WritableStream: "readonly",
      },
    },
  },
  prettier
);

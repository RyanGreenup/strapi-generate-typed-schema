import { defineConfig } from "@ryangreenup/eslint-config";

export default defineConfig(
  {
    solid: true,
    stylistic: false,
    formatters: false,
    tsconfigPath: "./tsconfig.json",
    ignores: ["**/.codemap/**"],
  },
  {
    files: ["**/*.tsx"],
    rules: {
      "sonarjs/prefer-read-only-props": "off",
    },
  },
  {
    files: ["package.json"],
    rules: {
      // oxfmt owns package metadata ordering as well as whitespace.
      "jsonc/sort-keys": "off",
    },
  },
);

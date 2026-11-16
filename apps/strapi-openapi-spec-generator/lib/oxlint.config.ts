import { base } from "@ryangreenup/oxlint-config";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [base],
  // The fixture is a Strapi project and templates/ is compiled inside one: neither resolves here.
  ignorePatterns: [
    "dist/**",
    "coverage/**",
    "tests/fixtures/**",
    "templates/**",
  ],
});

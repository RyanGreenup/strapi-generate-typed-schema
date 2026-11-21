import { defineConfig } from "tsdown";

export default defineConfig({
  dts: {
    generator: "tsgo",
  },
  exports: true,
  deps: {
    alwaysBundle: ["@ryangreenup/strapi-openapi-spec-generator-lib"],
  },
  copy: { from: "../lib/templates/rest-types.ts", to: "templates" },
});

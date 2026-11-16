import { defineConfig } from "oxlint";

export default defineConfig({
  categories: {
    correctness: "deny",
  },
  ignorePatterns: ["target/**", "coverage/**", "index.js", "index.d.ts"],
});

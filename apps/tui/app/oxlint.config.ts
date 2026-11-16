import { defineConfig } from "oxlint";

export default defineConfig({
  categories: {
    correctness: "deny",
  },
  ignorePatterns: ["dist/**", "coverage/**"],
});

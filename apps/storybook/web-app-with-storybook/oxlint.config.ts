import { solid, vite } from "@ryangreenup/oxlint-config";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [solid, vite],
  overrides: [
    {
      // Storybook's CSF format needs a default `meta` export followed by named
      // story exports, and `fn()` spies return values into void callbacks
      files: ["**/*.stories.ts"],
      rules: {
        "import/exports-last": "off",
        "import/no-default-export": "off",
        "typescript/strict-void-return": "off",
        "vitest/prefer-importing-vitest-globals": "off",
      },
    },
    {
      // Storybook loads these files by name and reads their default export
      files: [".storybook/*"],
      rules: {
        "import/no-default-export": "off",
      },
    },
    {
      // Plain stylesheets are imported for their side effect
      files: ["src/stories/*.tsx"],
      rules: {
        "import/no-unassigned-import": "off",
      },
    },
  ],
});

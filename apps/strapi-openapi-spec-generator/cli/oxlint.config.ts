import { cliCfg } from "@ryangreenup/oxlint-config";
import { defineConfig } from "oxlint";

export default defineConfig({
  extends: [cliCfg],
  overrides: [
    {
      // The e2e test blocks, synchronously is easier to read
      files: ["tests/**"],
      rules: {
        "node/no-sync": "off",
      },
    },
  ],
});

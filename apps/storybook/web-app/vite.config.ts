import type { UserConfig } from "vite";

import devtools from "solid-devtools/vite";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

const config: UserConfig = defineConfig({
  plugins: [devtools(), solidPlugin()],
  server: {
    port: 3000,
  },
  build: {
    target: "esnext",
  },
});

// Vite requires a default export for its config file
// oxlint-disable-next-line import/no-default-export
export default config;

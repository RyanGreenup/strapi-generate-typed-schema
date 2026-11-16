import type { StorybookConfig } from "storybook-solidjs-vite";

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolves the absolute path of a package.
 * Needed in projects that use Yarn PnP or are set up within a monorepo.
 */
function getAbsolutePath(value: string): string {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(js|jsx|mjs|ts|tsx)"],
  addons: [
    getAbsolutePath("@chromatic-com/storybook"),
    getAbsolutePath("@storybook/addon-vitest"),
    getAbsolutePath("@storybook/addon-a11y"),
    getAbsolutePath("@storybook/addon-docs"),
  ],
  // Exposes `./preset` only through package exports, so a directory path from
  // getAbsolutePath would not resolve
  framework: "storybook-solidjs-vite",
};

// Storybook requires a default export for its config file
// oxlint-disable-next-line import/no-default-export
export default config;

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The config pulls in antfu and the plugin tree, so it needs a bit of time.
    testTimeout: 30_000,
  },
})

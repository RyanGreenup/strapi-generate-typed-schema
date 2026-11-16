import { expect, it } from 'vitest'

import { defineOxlintConfig } from '../src/configs/oxlint.js'
import generatedSolidConfig from '../src/generated/oxlint-solid.js'

it('excludes ESLint-only extensions from migratable config', async () => {
  /** @type {import('@antfu/eslint-config').TypedFlatConfigItem} */
  const markdown = { files: ['**/*.md'], rules: { 'no-console': 'off' } }
  const config = await defineOxlintConfig({}, markdown)
  expect(config).not.toContain(markdown)
  expect(config.some(entry => entry.files?.includes('**/*.md/**'))).toBe(
    false,
  )
})

it('generates a Solid preset with type-aware rules and plugins', () => {
  const count
    = Object.keys(generatedSolidConfig.rules ?? {}).length
      + (generatedSolidConfig.overrides ?? []).reduce(
        (total, override) => total + Object.keys(override.rules ?? {}).length,
        0,
      )
  expect(generatedSolidConfig.plugins).toContain('typescript')
  expect(count).toBeGreaterThan(500)
})

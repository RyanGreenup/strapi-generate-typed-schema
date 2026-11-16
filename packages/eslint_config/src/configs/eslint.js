import antfu from '@antfu/eslint-config'
import { configs as sonarConfigs } from 'eslint-plugin-sonarjs'
import turboPlugin from 'eslint-plugin-turbo'

import { eslintOnlyExtensions } from '../extensions/eslint-only.js'
import { oxlintCompatibleExtensions } from '../extensions/oxlint-compatible.js'

/**
 * Build the full ESLint config on top of antfu.
 * @param {import('@antfu/eslint-config').OptionsConfig & { tsconfigPath?: string }} [options] antfu options plus the tsconfig to type-check against.
 * @param {...import('@antfu/eslint-config').TypedFlatConfigItem} userConfigs Consumer overrides applied last.
 */
export function defineConfig(options = {}, ...userConfigs) {
  const { tsconfigPath, ...rest } = options
  return antfu(
    {
      formatters: { css: true, html: true, markdown: 'dprint' },
      stylistic: { braceStyle: 'stroustrup', indent: 2, quotes: 'single' },
      ...(tsconfigPath ? { typescript: { tsconfigPath } } : {}),
      ...rest,
    },
    ...oxlintCompatibleExtensions(
      tsconfigPath,
      sonarConfigs.recommended,
      turboPlugin,
    ),
    ...eslintOnlyExtensions(),
    ...userConfigs,
  )
}

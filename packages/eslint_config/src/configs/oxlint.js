import antfu from '@antfu/eslint-config'
import { configs as sonarConfigs } from 'eslint-plugin-sonarjs'
import turboPlugin from 'eslint-plugin-turbo'

import { oxlintCompatibleExtensions } from '../extensions/oxlint-compatible.js'

/**
 * Build the subset of the ESLint config that migrates cleanly to Oxlint.
 * @param {import('@antfu/eslint-config').OptionsConfig & { tsconfigPath?: string }} [options] antfu options plus the tsconfig to type-check against.
 * @param {...import('@antfu/eslint-config').TypedFlatConfigItem} userConfigs Consumer overrides applied last.
 */
export function defineOxlintConfig(options = {}, ...userConfigs) {
  const { tsconfigPath, ...rest } = options
  return antfu(
    {
      stylistic: { braceStyle: 'stroustrup', indent: 2, quotes: 'single' },
      ...(tsconfigPath ? { typescript: { tsconfigPath } } : {}),
      ...rest,
      formatters: false,
      jsonc: false,
      markdown: false,
      toml: false,
      yaml: false,
    },
    ...oxlintCompatibleExtensions(
      tsconfigPath,
      sonarConfigs.recommended,
      turboPlugin,
    ),
    ...userConfigs.filter(
      config => !config.files?.some(file => file.includes('.md')),
    ),
  )
}

export default defineOxlintConfig({
  solid: true,
  tsconfigPath: './tsconfig.json',
})

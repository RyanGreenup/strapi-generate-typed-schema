/**
 * Config entries that only ESLint can apply.
 * @returns {import('@antfu/eslint-config').TypedFlatConfigItem[]} Entries to spread into antfu.
 */
export function eslintOnlyExtensions() {
  return [
    {
      files: ['**/*.md/**'],
      languageOptions: {
        parserOptions: { projectService: false, project: false },
      },
      rules: {
        'solid/jsx-no-undef': 'off',
        'sonarjs/unused-import': 'off',
        'unused-imports/no-unused-vars': 'off',
        'ts/no-unused-vars': 'off',
        'no-unused-vars': 'off',
      },
    },
  ]
}

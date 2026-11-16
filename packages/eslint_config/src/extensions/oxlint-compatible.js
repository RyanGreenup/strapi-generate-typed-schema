/**
 * Config entries that hold in both ESLint and the Oxlint migration.
 * @param {string | undefined} tsconfigPath Enables the project service when set.
 * @param {import('eslint').Linter.Config} sonarConfig The SonarJS preset to include.
 * @param {import('eslint').ESLint.Plugin} turboPlugin The Turborepo plugin.
 * @returns {import('@antfu/eslint-config').TypedFlatConfigItem[]} Entries to spread into antfu.
 */
export function oxlintCompatibleExtensions(
  tsconfigPath,
  sonarConfig,
  turboPlugin,
) {
  return [
    ...(tsconfigPath
      ? [
          {
            files: ['**/*.?([cm])ts', '**/*.?([cm])tsx', '**/*.?([cm])jsx'],
            languageOptions: {
              parserOptions: { projectService: true, project: false },
            },
          },
        ]
      : []),
    sonarConfig,
    {
      files: ['**/*.?([cm])js', '**/*.?([cm])jsx'],
      rules: {
        // The TypeScript rule used by unused-imports treats Espree references
        // as type-only. Use ESLint's core rule for JavaScript instead.
        'unused-imports/no-unused-vars': 'off',
        'no-unused-vars': [
          'error',
          {
            args: 'after-used',
            argsIgnorePattern: '^_',
            ignoreRestSiblings: true,
            vars: 'all',
            varsIgnorePattern: '^_',
          },
        ],
      },
    },
    {
      plugins: { turbo: turboPlugin },
      rules: {
        // Mirrors the oxlint base preset: document exports, and let the
        // TypeScript signature carry the parameter and return types.
        'jsdoc/require-jsdoc': ['error', { publicOnly: true }],
        'jsdoc/require-param': 'off',
        'jsdoc/require-returns': 'off',
        'turbo/no-undeclared-env-vars': 'error',
      },
    },
  ]
}

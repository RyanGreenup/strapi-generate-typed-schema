# @ryangreenup/eslint-config

Shared ESLint configuration and generated Oxlint presets.

## Structure

- `src/configs` contains the ESLint builder, migratable Oxlint source, and Solid
  preset.
- `src/extensions` separates Oxlint-compatible rules from ESLint-only rules.
- `src/generated` contains the committed generated Oxlint preset.
- `test` verifies public exports and configuration composition.

Regenerate the Solid preset with `pnpm generate:oxlint`. Consumers can extend
it:

```ts
import solidConfig from '@ryangreenup/eslint-config/oxlint/solid'
import { defineConfig } from 'oxlint'

export default defineConfig({
  extends: [solidConfig],
  options: { typeAware: true },
})
```

Shared [antfu](https://github.com/antfu/eslint-config) flat ESLint config for
packages in this workspace. It is the type-aware, plugin-rich linter; the fast
per-package linting is done by [`@ryangreenup/oxlint-config`](../oxlint-config/README.md)
(oxlint/oxfmt). Use whichever fits a given package, or both.

## Usage

Add the config as a dev dependency and create an `eslint.config.mjs` in the
package:

```js
import { defineConfig } from '@ryangreenup/eslint-config'

export default defineConfig()
```

`defineConfig(options, ...userConfigs)` forwards `options` to antfu, so
framework toggles (`solid: true`, `react: true`) and extra `ignores` work as
documented there. Passing `tsconfigPath` turns on type-aware rules and switches
the TypeScript project service on, so every linted file must belong to a
tsconfig.

Trailing arguments are plain flat-config objects, appended last, which makes
them the place to relax a rule for one package:

```js
export default defineConfig(
  { tsconfigPath: './tsconfig.json' },
  { files: ['**/*.test.ts'], rules: { 'no-console': 'off' } },
)
```

## Baked-in opinions

- antfu stylistic rules: 2-space indent, single quotes, stroustrup braces.
- Formatters for CSS, HTML, and markdown (markdown via dprint, which leaves
  callouts alone).
- `eslint-plugin-sonarjs` recommended rules.
- `turbo/no-undeclared-env-vars`, so any env var read by code must be declared
  in `turbo.json`.
- Code fences inside markdown are linted syntactically only.

## Presets

- `@ryangreenup/eslint-config` - the `defineConfig` factory shown above.
- `@ryangreenup/eslint-config/solid` - a ready-made config for a SolidJS + Vite app
  (type-aware, Playwright and generated route trees ignored). Re-export it
  directly:

  ```js
  export { default } from '@ryangreenup/eslint-config/solid'
  ```

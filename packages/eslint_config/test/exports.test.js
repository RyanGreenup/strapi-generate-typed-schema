import { expect, it } from 'vitest'

it('exports both config builders from the public entry point', async () => {
  const config = await import('@ryangreenup/eslint-config')
  expect(config.defineConfig).toBeTypeOf('function')
  expect(config.defineOxlintConfig).toBeTypeOf('function')
})

it('imports preset subpaths', async () => {
  const [{ default: solid }, { default: oxlintSolid }] = await Promise.all([
    import('@ryangreenup/eslint-config/solid'),
    import('@ryangreenup/eslint-config/oxlint/solid'),
  ])
  expect(solid).toBeTruthy()
  expect(oxlintSolid).toBeTypeOf('object')
})

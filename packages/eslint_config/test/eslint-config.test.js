import { ESLint } from 'eslint'
import { expect, it } from 'vitest'

import { defineConfig } from '../src/configs/eslint.js'

it('includes shared and consumer ESLint config', async () => {
  /** @type {import('@antfu/eslint-config').TypedFlatConfigItem} */
  const consumer = { name: 'test/consumer', rules: { 'no-console': 'off' } }
  const config = await defineConfig({}, consumer)
  expect(config.some(entry => entry.name === 'test/consumer')).toBe(true)
  expect(
    config.some(
      entry => entry.rules?.['turbo/no-undeclared-env-vars'] === 'error',
    ),
  ).toBe(true)
  expect(config.some(entry => entry.files?.includes('**/*.md/**'))).toBe(
    true,
  )
})

it.each(['js', 'mjs', 'cjs', 'jsx'])(
  'checks JavaScript runtime references in .%s files',
  async (extension) => {
    const eslint = new ESLint({
      overrideConfigFile: true,
      overrideConfig: await defineConfig(),
    })
    const [result] = await eslint.lintText(
      [
        'const used = 1',
        'const unused = 2',
        'const _ignored = 3',
        'console.log(used)',
        '',
      ].join('\n'),
      { filePath: `runtime.${extension}` },
    )
    const unusedMessages = result.messages.filter(message =>
      message.ruleId?.includes('no-unused-vars'),
    )
    expect(unusedMessages).toHaveLength(1)
    expect(unusedMessages[0].ruleId).toBe('no-unused-vars')
    expect(unusedMessages[0].message).toContain('\'unused\'')
  },
)

// @ts-check
import { antfu } from '@antfu/eslint-config'

export default antfu({
  type: 'lib',
  pnpm: true,
  typescript: {
    tsconfigPath: './tsconfig.json',
  },
  test: {
    overrides: {
      'test/prefer-lowercase-title': ['error', { ignoreTopLevelDescribe: true }],
    },
  },
})

import nextConfig from 'eslint-config-next'

const config = [
  ...nextConfig,
  {
    ignores: ['bot/**', 'coverage/**', '__tests__/**', 'prisma/seed.ts'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    rules: {
      'react-hooks/exhaustive-deps': 'warn',
      // React 19 + plugin v7 introduisent cette règle stricte sur des
      // patterns présents dans toutes nos pages dashboard. À traiter dans
      // un refactor UI dédié (data fetching → SWR / React Query).
      'react-hooks/set-state-in-effect': 'warn',
      '@next/next/no-img-element': 'off',
    },
  },
]

export default config

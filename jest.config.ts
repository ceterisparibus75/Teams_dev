import type { Config } from 'jest'

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testMatch: ['**/__tests__/**/*.test.ts'],
  // Compilation ts-jest partagée entre suites — évite les échecs intermittents
  // au chargement parallèle (microsoft-graph.test, etc.)
  maxWorkers: 1,
}

export default config

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  clearMocks: true,
  cacheDirectory: '<rootDir>/.cache/jest',
  modulePathIgnorePatterns: ['<rootDir>/.cache/', '<rootDir>/dist/', '<rootDir>/coverage/'],
  collectCoverageFrom: [
    'src/core/money/**/*.ts',
    'src/core/dates/**/*.ts',
    'src/core/database/encryptedConnection.ts',
    'src/core/database/schema.ts',
    'src/core/database/financeRepository.ts',
    'src/core/security/nativeVault.ts',
    'src/core/security/vaultSession.ts',
    'src/features/accounts/domain/**/*.ts',
    'src/features/transactions/domain/**/*.ts',
    'src/features/budgets/domain/**/*.ts',
    '!**/__tests__/**',
  ],
};

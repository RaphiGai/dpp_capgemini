module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  testPathIgnorePatterns: ['/node_modules/', '/gen/', '/blockchain/'],
  modulePathIgnorePatterns: ['/gen/', '/blockchain/'],
  setupFilesAfterEnv: ['<rootDir>/test/helpers/setup.js'],
  collectCoverageFrom: ['srv/**/*.js', '!srv/abi/**'],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 60,
      lines: 60,
      statements: 60
    }
  },
  testTimeout: 30000
};

const config = {
    testTimeout: 60000,
    testMatch: ['**/*.test.js'],
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
    forceExit: true,
    detectOpenHandles: true
  }

module.exports = config
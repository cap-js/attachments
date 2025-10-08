const config = {
    testTimeout: 42222,
    testMatch: ['**/*.test.js'],
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
    forceExit: true,
    detectOpenHandles: true
  }

module.exports = config
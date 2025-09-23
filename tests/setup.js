// Test setup file to mock logger for all tests
jest.doMock('../lib/logger', () => ({
  logConfig: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    configValidation: jest.fn(),
    tokenFetch: jest.fn(),
    s3Operation: jest.fn(),
    fileOperation: jest.fn(),
    malwareScan: jest.fn(),
    processStep: jest.fn(),
    withSuggestion: jest.fn()
  },
  attachmentsLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    verbose: jest.fn(),
    logConfigValidation: jest.fn(),
    logTokenFetch: jest.fn(),
    logS3Operation: jest.fn(),
    logFileOperation: jest.fn(),
    logMalwareScan: jest.fn(),
    logProcessStep: jest.fn(),
    logWithSuggestion: jest.fn()
  }
}));

// Suppress console output in tests
const originalConsole = global.console;
global.console = {
  ...originalConsole,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};
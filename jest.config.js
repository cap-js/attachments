const config = {
  testTimeout: 180000,
  testMatch: ["**/*.test.js"],
  forceExit: true,
  // https-proxy-agent and http-proxy-agent v7+ are ESM-only. On Node < 24.9,
  // Jest's CJS runtime cannot require() them. They are pulled in transitively
  // by @typespec/ts-http-runtime (via @azure/storage-blob), which has a CJS
  // build that still calls require() on these ESM-only packages. Stub them
  // globally so the require() call never reaches their ESM entry points.
  moduleNameMapper: {
    "^https-proxy-agent$": "<rootDir>/tests/mocks/proxy-agent.cjs",
    "^http-proxy-agent$": "<rootDir>/tests/mocks/proxy-agent.cjs",
  },
}

module.exports = config

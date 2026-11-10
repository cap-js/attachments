"use strict"
// Stub for https-proxy-agent and http-proxy-agent (v7+ ESM-only).
// Jest's CJS runtime cannot require() ESM entry points on Node < 24.9.
// These packages are only used for proxy support inside @typespec/ts-http-runtime
// (pulled in by @azure/storage-blob) and are never exercised in tests.
class HttpsProxyAgent {}
class HttpProxyAgent {}
module.exports = { HttpsProxyAgent, HttpProxyAgent }

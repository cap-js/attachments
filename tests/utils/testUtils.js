/**
 * Waits for attachment scanning to complete
 * @param {number} timeout - Timeout in milliseconds (default: 5000)
 * @returns {Promise<void>}
 */
async function waitForScanning(timeout = 5000) {
  return new Promise(resolve => setTimeout(resolve, timeout))
}

export default {
  waitForScanning,
}

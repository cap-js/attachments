const cds = require("@sap/cds")

const cache = new Map()

async function token(credentials, options = {}) {
  if (cds.utils.token) return cds.utils.token(credentials, options)

  const endpoint = new URL(credentials.certurl || credentials.url)
  endpoint.pathname =
    options.path ?? (credentials.certificate ? "/oauth2/token" : "/oauth/token")
  const form = { grant_type: "client_credentials", ...options.form }
  const cacheKey = `${endpoint}:${credentials.clientid}:${JSON.stringify(form)}`
  const hit = cache.get(cacheKey)
  if (hit && hit.expires > Date.now()) return hit.token

  const body = new URLSearchParams({
    client_id: credentials.clientid,
    ...form,
  }).toString()
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/x-www-form-urlencoded",
  }
  if (!credentials.certificate && credentials.clientsecret) {
    headers.Authorization =
      "Basic " +
      Buffer.from(
        `${credentials.clientid}:${credentials.clientsecret}`,
      ).toString("base64")
  }
  const response = credentials.certificate
    ? await post(endpoint, { headers, body, ...credentials })
    : await fetch(endpoint, { method: "POST", headers, body })
  const result = await response.json()
  if (!response.ok) {
    const error = new Error(
      `OAuth token request failed with status ${response.status}`,
    )
    error.status = response.status
    error.response = { status: response.status, data: result }
    throw error
  }
  if (!result?.access_token)
    throw new Error("Access token not found in OAuth token response")
  cache.set(cacheKey, {
    token: result.access_token,
    expires:
      Date.now() + Math.max(0, (result.expires_in ?? 3600) * 1000 - 60_000),
  })
  return result.access_token
}

function post(url, { headers, body, certificate, key }) {
  return new Promise((resolve, reject) => {
    const request = require("node:https").request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: "POST",
        headers,
        cert: certificate,
        key,
      },
      (response) => {
        const chunks = []
        response.on("data", (chunk) => chunks.push(chunk))
        response.on("end", () => {
          const data = Buffer.concat(chunks).toString()
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            status: response.statusCode,
            json: async () => JSON.parse(data),
          })
        })
      },
    )
    request.on("error", reject)
    request.end(body)
  })
}

module.exports = { token }

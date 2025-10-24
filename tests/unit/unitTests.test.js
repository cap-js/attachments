let mockAttachmentsSrv, key, req = {}

const validCert = "-----BEGIN CERTIFICATE-----\nMIIDbTCCAlWgAwIBAgIUOtfA6VNuNW1ZU4TQmBr1io86kXowDQYJKoZIhvcNAQEL\nBQAwRTELMAkGA1UEBhMCQVUxEzARBgNVBAgMClNvbWUtU3RhdGUxITAfBgNVBAoM\nGEludGVybmV0IFdpZGdpdHMgUHR5IEx0ZDAgFw0yNTEwMjMwNzM2NTRaGA8yMDU1\nMTAxNjA3MzY1NFowRTELMAkGA1UEBhMCQVUxEzARBgNVBAgMClNvbWUtU3RhdGUx\nITAfBgNVBAoMGEludGVybmV0IFdpZGdpdHMgUHR5IEx0ZDCCASIwDQYJKoZIhvcN\nAQEBBQADggEPADCCAQoCggEBAO+NhuWAbRo+z2a52YfyRtuXEqZySvhlEneaesNT\nXrSZP9tIeGR0wUZOT7no73+SNAjNCuHA/U+jpm1W3po1BtRJTgpDU5+mu2WhsqKi\nGEKkLmBO7d8gHKQyEWoYJc8yqU3UIOtlmTXETEZbW8Ee8/Iaqi1xyGCh3I8H/qiY\nlkFUZX2ZeuFmo1ueR3lTxjujG7q+oK1kDRHrAHcO8WopSnAvcCL47DBhI3fniJo1\nb3tbYGVTGWdx3C9z0SeCdQ4rfLjfMV+0gix9hZCO6Di6f86BUhQpJWmdTALfoY6P\nsP2BRU0Y0KmpQgw4BZvlPvtsAZD10Qhgc3fPuT1+gEqgnK8CAwEAAaNTMFEwHQYD\nVR0OBBYEFMD3McHmLuwnZGc0c7kyjIzf2y6/MB8GA1UdIwQYMBaAFMD3McHmLuwn\nZGc0c7kyjIzf2y6/MA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEB\nAFB1Z43T4TAdwjhh7ynvw+wqFeWFE3ZUCUjMM/AIckFgG+1XF9aVbr226obsclEc\n+YAdsmrVUY6yPLbfLAJFVP6pMJslq85wF2C+vb61MFZb1NKIFc3HNxlWLAMfGli7\nNvzbRp21a6RLK0tghHdKWuekdit/wfvMqgWUqJI5Pm/NuOupClpCOLQOy9Nxwyyl\nYU8cqOzBgCXyVfMM4IWfkDdFfbdbX3k+mY/jOmC+5qIqPrR0rnvJwVJd3z+pW62D\n42rYCQqToHXqH1LTYEIMiZZFG9ZlpT2RQZFOgLcpsuTQKgo77T32DEvJk018xK0I\nQ/H33UI3Zp4U/YRmL18jyLU=\n-----END CERTIFICATE-----"
const expiredCert = "-----BEGIN CERTIFICATE-----\nMIIDazCCAlOgAwIBAgIUSIZ70YxKWyJTPhAaHW4lysXYk30wDQYJKoZIhvcNAQEL\nBQAwRTELMAkGA1UEBhMCQVUxEzARBgNVBAgMClNvbWUtU3RhdGUxITAfBgNVBAoM\nGEludGVybmV0IFdpZGdpdHMgUHR5IEx0ZDAeFw0yMDA4MDEwMTAwMDBaFw0yMDEw\nMDEwMTAwMDBaMEUxCzAJBgNVBAYTAkFVMRMwEQYDVQQIDApTb21lLVN0YXRlMSEw\nHwYDVQQKDBhJbnRlcm5ldCBXaWRnaXRzIFB0eSBMdGQwggEiMA0GCSqGSIb3DQEB\nAQUAA4IBDwAwggEKAoIBAQDlP6mPHLokEiD2faTK2hBiyv2wKtDNiHt0sSeP8ae7\ns+IAIwAX+pmw7QMIYDcQQO6c7Lfle7c/XtUMirJik3/zdjOfrX1qsxMFXTgnwmqH\n9njrGDgs4OK9+l5fkhtcX8YkxkxfoLSO7gGrO2Xv+KeDVmysD5JBrfp2UQFLPp6/\n6ohAZQeHEqx/snfcypEd+K8llBORsKo7tB15Yt5jRSUsuaiGVPPVcCPi9yUcvXHJ\nA7Jv/c0zSiM23pby39tCnZX0KCyBZ2aJMSiWk+Txd0uib5fX7Ln2AS1wOvjVOLNM\nIwcVibyvEGo5DDEzpt6li1BYpLltxLLqftEpLB5NzA6fAgMBAAGjUzBRMB0GA1Ud\nDgQWBBRyUe78kMLzNpV2q3jf5xT6Cu3KrDAfBgNVHSMEGDAWgBRyUe78kMLzNpV2\nq3jf5xT6Cu3KrDAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQCG\nLL6V13KzKQlLvvTThywV7rOyKqHtZYPUFV+hnHDLaEfJhqVzFIK4SL+K6/VQrj3B\n3BEWh3tAaeaKwAj6BSGGYH/OCA5Vl4yewFLMfostw7LyrLkHlbkhALmC7j5TWapR\ni/tHFifcAYkQnMip1HrOTeGxjEd4RV2kILIsd8ukNv54KAnsxpIIQt2AOhy6LzIs\nkWJOf0IMAusn/PgXBKBJ+YonsldsavC/TBSi3qZXWygcsD1ISviBNIjcS7hbejU8\nLseGs+B6YGIC/Ow6zD71UuOYvQnvjhJG/syaUoUivVppbxbvZyZi7bg48RZLxxig\np3fwjV9eQceKgnNUvzhg\n-----END CERTIFICATE-----"

jest.mock('@sap/cds', () => ({
  ql: { UPDATE: jest.fn(() => ({ with: jest.fn() })) },
  debug: jest.fn(),
  log: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    _debug: true
  })),
  Service: class { },
  connect: {
    to: () => Promise.resolve(mockAttachmentsSrv)
  },
  env: { requires: {} }
}))

global.fetch = jest.fn(() => Promise.resolve({
  json: () => Promise.resolve({ malwareDetected: false })
}))

jest.mock('axios')

// Mock individual functions used in malwareScanner since it imports logger
jest.doMock('../../lib/malwareScanner', () => {
  const original = jest.requireActual('../../lib/malwareScanner')
  return {
    ...original,
    // Override streamToString to return a simple string
    streamToString: jest.fn(() => Promise.resolve('test-file-content'))
  }
})

const { scanRequest } = require('../../lib/malwareScanner')
const { getObjectStoreCredentials, fetchToken } = require('../../lib/helper')
const axios = require('axios')
const AttachmentsService = require('../../lib/basic')
const cds = require('@sap/cds')
const { Readable } = require('stream')

beforeEach(() => {
  jest.clearAllMocks()
  mockAttachmentsSrv = {
    get: jest.fn(() => {
      const stream = new Readable()
      stream.push('test content')
      stream.push(null)
      return Promise.resolve(stream)
    }),
    update: jest.fn(() => Promise.resolve()),
    deleteInfectedAttachment: jest.fn(() => Promise.resolve()),
    getStatus: jest.fn(() => { process.stdout.write('getStatus called'); return Promise.resolve('Clean') }),
    put: jest.fn(() => { process.stdout.write('put called'); return Promise.resolve() }),
  }
  cds.env = {
    requires: {
      attachments: { scan: true }
    },
    profiles: []
  }
  global.fetch = jest.fn(() => Promise.resolve({
    json: () => Promise.resolve({ malwareDetected: false }),
    status: 200
  }))
  key = { ID: 'test-id' }
  req = {}
})

describe('scanRequest with mTLS', () => {
  beforeEach(() => {
    if (!cds.env.requires.malwareScanner) {
      cds.env.requires.malwareScanner = {}
    }
    cds.env.requires.malwareScanner.credentials = {
      uri: 'scanner.example.com',
      certificate: validCert,
      key: '-----BEGIN PRIVATE KEY-----\nFAKEKEY\n-----END PRIVATE KEY-----'
    }
  })
  it('should raise an error if certificate is expired', async () => {
    cds.env.requires.malwareScanner.credentials.certificate = expiredCert

    try {
      await scanRequest({ name: 'Attachments' }, key, req)
    } catch (error) {
      expect(error.message).toBe('The provided certificate has expired.')
    }

    expect(mockAttachmentsSrv.update).toHaveBeenCalledWith(expect.anything(), key, { status: 'Failed' })
  })
  it('should update status to "Scanning" and "Clean" if no malware detected', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ malwareDetected: false })
      })
    )
    await scanRequest({ name: 'Attachments' }, key, req)
    expect(mockAttachmentsSrv.update).toHaveBeenCalled()
    expect(mockAttachmentsSrv.deleteInfectedAttachment).not.toHaveBeenCalled()
  })

  it('should update status to "Infected" and delete content if malware detected', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ malwareDetected: true }),
        status: 200
      })
    )
    await scanRequest({ name: 'Attachments' }, key, req)
    expect(mockAttachmentsSrv.deleteInfectedAttachment).toHaveBeenCalled()
    expect(mockAttachmentsSrv.update).toHaveBeenCalled()
  })

  it('should update status to "Failed" if fetch throws', async () => {
    global.fetch = jest.fn(() => { throw new Error('Network error') })
    await scanRequest({ name: 'Attachments' }, key, req)
    expect(mockAttachmentsSrv.update).toHaveBeenCalledWith(expect.anything(), key, { status: 'Failed' })
  })

  it('should handle missing credentials gracefully', async () => {
    const Attachments = { name: 'TestAttachments' }
    const key = { ID: 'test-id' }
    cds.env = { requires: {}, profiles: [] }

    try {
      await scanRequest(Attachments, key)
    } catch (error) {
      expect(error.message).toBe("SAP Malware Scanning service is not bound.")
    }

    expect(mockAttachmentsSrv.update).toHaveBeenCalledWith(expect.anything(), key, { status: 'Failed' })
  })
})

describe('scanRequest with basic auth', () => {
  beforeEach(() => {
    if (!cds.env.requires.malwareScanner) {
      cds.env.requires.malwareScanner = {}
    }
    cds.env.requires.malwareScanner.credentials = {
      uri: 'scanner.example.com',
      username: 'user',
      password: 'pass'
    }
  })
  it('should update status to "Scanning" and "Clean" if no malware detected', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ malwareDetected: false })
      })
    )
    await scanRequest({ name: 'Attachments' }, key, req)
    expect(mockAttachmentsSrv.update).toHaveBeenCalled()
    expect(mockAttachmentsSrv.deleteInfectedAttachment).not.toHaveBeenCalled()
  })

  it('should update status to "Infected" and delete content if malware detected', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ malwareDetected: true }),
        status: 200
      })
    )
    await scanRequest({ name: 'Attachments' }, key, req)
    expect(mockAttachmentsSrv.deleteInfectedAttachment).toHaveBeenCalled()
    expect(mockAttachmentsSrv.update).toHaveBeenCalled()
  })

  it('should update status to "Failed" if fetch throws', async () => {
    global.fetch = jest.fn(() => { throw new Error('Network error') })
    await scanRequest({ name: 'Attachments' }, key, req)
    expect(mockAttachmentsSrv.update).toHaveBeenCalledWith(expect.anything(), key, { status: 'Failed' })
  })

  it('should handle missing credentials gracefully', async () => {
    const Attachments = { name: 'TestAttachments' }
    const key = { ID: 'test-id' }
    cds.env = { requires: {}, profiles: [] }

    try {
      await scanRequest(Attachments, key)
    } catch (error) {
      expect(error.message).toBe("SAP Malware Scanning service is not bound.")
    }

    expect(mockAttachmentsSrv.update).toHaveBeenCalledWith(expect.anything(), key, { status: 'Failed' })
  })
})

describe('getObjectStoreCredentials', () => {
  it('should return credentials from service manager', async () => {
    axios.get.mockResolvedValue({ data: { items: [{ id: 'test-cred' }] } })
    const creds = await getObjectStoreCredentials('tenant', 'url', 'token')
    expect(creds.id).toBe('test-cred')
  })

  it('should return null when tenant ID is missing', async () => {
    const creds = await getObjectStoreCredentials(null, 'url', 'token')
    expect(creds).toBeNull()
  })

  it('should return null when sm_url is missing', async () => {
    const creds = await getObjectStoreCredentials('tenant', null, 'token')
    expect(creds).toBeNull()
  })

  it('should return null when token is missing', async () => {
    const creds = await getObjectStoreCredentials('tenant', 'url', null)
    expect(creds).toBeNull()
  })

  it('should handle error gracefully and return null', async () => {
    axios.get.mockRejectedValue(new Error('fail'))
    const creds = await getObjectStoreCredentials('tenant', 'url', 'token')
    expect(creds).toBeNull()
  })
})

describe('fetchToken', () => {
  it('should return a token when axios resolves', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'test-token' } })
    const token = await fetchToken('url', 'clientId', 'clientSecret')
    expect(token).toBe('test-token')
  })

  it('should throw when client ID is missing', async () => {
    await expect(fetchToken('url', null, 'clientSecret')).rejects.toThrow('Client ID is required for token fetching')
  })

  it('should throw when neither client secret nor certificate is provided', async () => {
    await expect(fetchToken('url', 'clientId', null)).rejects.toThrow('Invalid credentials provided for token fetching')
  })

  it('should handle error and throw', async () => {
    axios.post.mockRejectedValue(new Error('fail'))
    await expect(fetchToken('url', 'clientId', 'clientSecret')).rejects.toThrow('fail')
  })
})

describe('AttachmentsService', () => {
  let service
  beforeEach(() => {
    service = new AttachmentsService()
  })

  it('deleteInfectedAttachment should call UPDATE with content null', async () => {
    const Attachments = {}
    const key = {}
    await service.deleteInfectedAttachment(Attachments, key)
    expect(cds.ql.UPDATE).toHaveBeenCalledWith(Attachments, key)
  })
})

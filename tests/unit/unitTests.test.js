let mockAttachmentsSrv, key = {}

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
      malwareScanner: {
        credentials: {
          uri: 'scanner.example.com',
          username: 'user',
          password: 'pass'
        }
      },
      attachments: { scan: true }
    },
    profiles: []
  }
  global.fetch = jest.fn(() => Promise.resolve({
    json: () => Promise.resolve({ malwareDetected: false }),
    status: 200
  }))
  key = { ID: 'test-id' }
})

describe('scanRequest', () => {
  it('should update status to "Scanning" and "Clean" if no malware detected', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ malwareDetected: false })
      })
    )
    await scanRequest({ name: 'Attachments' }, key)
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
    await scanRequest({ name: 'Attachments' }, key)
    expect(mockAttachmentsSrv.deleteInfectedAttachment).toHaveBeenCalled()
    expect(mockAttachmentsSrv.update).toHaveBeenCalled()
  })

  it('should update status to "Failed" if fetch throws', async () => {
    global.fetch = jest.fn(() => { throw new Error('Network error') })
    await scanRequest({ name: 'Attachments' }, key)
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
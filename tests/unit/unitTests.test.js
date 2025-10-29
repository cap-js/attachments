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

const { getObjectStoreCredentials, fetchToken } = require('../../lib/helper')
const axios = require('axios')
const AttachmentsService = require('../../lib/basic')
const cds = require('@sap/cds')
const { Readable } = require('stream')

beforeEach(() => {
  jest.clearAllMocks()
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
})

describe('getObjectStoreCredentials', () => {
  it('should return credentials from service manager', async () => {
    cds.env.requires.serviceManager = {
      credentials: {
        sm_url: 'https://sm.example.com',
        url: 'https://token.example.com',
        clientid: 'client-id',
        clientsecret: 'client-secret'
      }
    }

    axios.get.mockResolvedValue({ data: { items: [{ id: 'test-cred' }] } })
    axios.post.mockResolvedValue({ data: { access_token: 'test-token' } })

    const creds = await getObjectStoreCredentials('tenant')
    expect(creds.id).toBe('test-cred')
  })

  it('should return null when tenant ID is missing', async () => {
    cds.env.requires.serviceManager = {
      credentials: {
        sm_url: 'https://sm.example.com',
        url: 'https://token.example.com',
        clientid: 'client-id',
        clientsecret: 'client-secret'
      }
    }

    const creds = await getObjectStoreCredentials(null)
    expect(creds).toBeNull()
  })

  it('should throw error if credentials are missing', async () => {
    try {
      await getObjectStoreCredentials('tenant')
    } catch (err) {
      expect(err.message).toBe('Service Manager Instance is not bound')
    }
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
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
jest.doMock('../../srv/malwareScanner', () => {
  const original = jest.requireActual('../../srv/malwareScanner')
  return {
    ...original,
    // Override streamToString to return a simple string
    streamToString: jest.fn(() => Promise.resolve('test-file-content'))
  }
})

const { getObjectStoreCredentials, fetchToken, sizeInBytes, MAX_FILE_SIZE } = require('../../lib/helper')
const axios = require('axios')
const cds = require('@sap/cds')

beforeEach(() => {
  jest.clearAllMocks()
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
    await getObjectStoreCredentials('tenant').catch(e => {
      expect(e.message).toBe('Service Manager Instance is not bound')
    })
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

describe('max attachment size', () => {
  test('should return 400MB in normal scenario', () => {
    expect(MAX_FILE_SIZE()).toEqual(400 * 1024 * 1024)
  })
  test('should return -1 when scan is disabled', () => {
    cds.env.requires.attachments.scan = false
    expect(MAX_FILE_SIZE()).toEqual(-1)
  })
})

describe('size to byte converter', () => {
  test('conversion of size string converts correctly to file size', () => {
    expect(sizeInBytes('20MB')).toEqual(20 * 1024 * 1024)
    expect(sizeInBytes('20MiB')).toEqual(20 * 1024 * 1024)
    expect(sizeInBytes('20kiB')).toEqual(20 * 1024)
    expect(sizeInBytes('20kB')).toEqual(20 * 1024)
    expect(sizeInBytes('20GB')).toEqual(20 * 1024 * 1024 * 1024)
  })

  test('conversion of size string returns number if the input param is a number', () => {
    expect(sizeInBytes(1234)).toEqual(1234)
  })

  test('conversion of size string returns undefined if no size could be determined', () => {
    expect(sizeInBytes('ABCDEFG')).toEqual(undefined)

    expect(sizeInBytes(undefined)).toEqual(undefined)

    expect(sizeInBytes({$edmJson: 'Dummy Value'})).toEqual(undefined)
  })
})

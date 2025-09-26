const axios = require('axios')
const { logConfig } = require('../../lib/logger')

// Mock dependencies
jest.mock('axios')
jest.mock('https')
jest.mock('../../lib/logger', () => ({
    logConfig: {
        debug: jest.fn(),
        withSuggestion: jest.fn(),
        warn: jest.fn()
    }
}))

const {
    _fetchToken,
    _validateSMCredentials,
    _serviceManagerRequest,
    _getOfferingID,
    _getPlanID,
    _createObjectStoreInstance
} = require('../../lib/mtx/server')

// Helper credentials
const oauthCreds = {
    url: 'https://sm.example.com',
    clientid: 'test-client',
    clientsecret: 'test-secret'
}
const mtlsCreds = {
    url: 'https://sm.example.com',
    certificate: 'cert-data',
    key: 'key-data'
}

beforeEach(() => {
    jest.clearAllMocks()
})

describe('_validateSMCredentials', () => {
    it('throws error if sm_url or url is missing', () => {
        expect(() => _validateSMCredentials({})).toThrow(/Missing Service Manager credentials/)
    })

    it('logs debug and throws error if both oauth and mtls credentials are missing', () => {
        expect(() => _validateSMCredentials({ sm_url: 'foo', url: 'bar' })).toThrow(/MTLS credentials are also missing/)
        expect(logConfig.debug).toHaveBeenCalled()
        expect(logConfig.withSuggestion).toHaveBeenCalled()
    })

    it('does not throw if oauth credentials are present', () => {
        expect(() => _validateSMCredentials({ sm_url: 'foo', url: 'bar', clientid: 'id', clientsecret: 'sec' })).not.toThrow()
    })

    it('does not throw if mtls credentials are present', () => {
        expect(() => _validateSMCredentials({ sm_url: 'foo', url: 'bar', certificate: 'cert', key: 'key' })).not.toThrow()
    })
})

describe('_fetchToken', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('fetches token using OAuth client credentials', async () => {
        axios.post.mockResolvedValue({ data: { access_token: 'oauth-token' } })
        const token = await _fetchToken(oauthCreds.url, oauthCreds.clientid, oauthCreds.clientsecret)
        expect(token).toBe('oauth-token')
        expect(axios.post).toHaveBeenCalled()
        expect(logConfig.debug).toHaveBeenCalledWith(
            'Using OAuth client credentials to fetch token.',
            expect.objectContaining({ url: oauthCreds.url, clientid: oauthCreds.clientid })
        )
    })

    it('throws error if OAuth response does not contain access_token', async () => {
        axios.post.mockResolvedValue({ data: {} })
        await expect(_fetchToken(oauthCreds.url, oauthCreds.clientid, oauthCreds.clientsecret))
            .rejects.toThrow(/Access token not found/)
        expect(logConfig.withSuggestion).toHaveBeenCalled()
    })

    it('fetches token using MTLS credentials', async () => {
        axios.post.mockResolvedValue({ data: { access_token: 'mtls-token' } })
        const token = await _fetchToken(mtlsCreds.url, null, null, mtlsCreds.certificate, mtlsCreds.key)
        expect(token).toBe('mtls-token')
        expect(axios.post).toHaveBeenCalled()
        expect(logConfig.debug).toHaveBeenCalledWith(
            'MTLS certificate and key found - proceeding with MTLS token fetch.',
            expect.objectContaining({ url: mtlsCreds.url, clientid: null })
        )
    })

    it('throws error if MTLS response does not contain access_token', async () => {
        axios.post.mockResolvedValue({ data: {} })
        await expect(_fetchToken(mtlsCreds.url, null, null, mtlsCreds.certificate, mtlsCreds.key))
            .rejects.toThrow(/Access token not found/)
        expect(logConfig.withSuggestion).toHaveBeenCalled()
    })

    it('throws error if neither OAuth nor MTLS credentials are provided', async () => {
        await expect(_fetchToken('https://sm.example.com'))
            .rejects.toThrow(/Missing authentication credentials/)
    })

    it('logs error and throws if axios throws', async () => {
        axios.post.mockRejectedValue(new Error('Network error'))
        await expect(_fetchToken(oauthCreds.url, oauthCreds.clientid, oauthCreds.clientsecret))
            .rejects.toThrow(/Network error/)
        expect(logConfig.withSuggestion).toHaveBeenCalled()
    })
})

describe('_serviceManagerRequest', () => {
    const sm_url = 'https://sm.example.com'
    const token = 'test-token'
    const path = 'v1/service_offerings'
    const params = { fieldQuery: "name eq 'objectstore'" }

    beforeEach(() => {
        jest.clearAllMocks()
    })

    it('returns first item from response data.items', async () => {
        axios.mockResolvedValue({
            data: { items: [{ id: 'item1', name: 'objectstore' }] }
        })
        const result = await _serviceManagerRequest(sm_url, 'get', path, token, params)
        expect(result).toEqual({ id: 'item1', name: 'objectstore' })
        expect(axios).toHaveBeenCalledWith(expect.objectContaining({
            method: 'get',
            url: `${sm_url}/${path}`,
            headers: expect.objectContaining({
                'Authorization': `Bearer ${token}`
            }),
            params
        }))
    })

    it('returns undefined if response data.items is undefined', async () => {
        axios.mockResolvedValue({ data: {} })
        const result = await _serviceManagerRequest(sm_url, 'get', path, token, params)
        expect(result).toBeUndefined()
    })

    it('logs error and returns undefined if axios throws', async () => {
        axios.mockRejectedValue(new Error('API error'))
        const result = await _serviceManagerRequest(sm_url, 'get', path, token, params)
        expect(result).toBeUndefined()
        expect(logConfig.withSuggestion).toHaveBeenCalledWith(
            'error',
            expect.stringContaining('Service Manager API request failed'),
            expect.any(Error),
            expect.any(String),
            expect.objectContaining({ method: 'get', path, sm_url, params })
        )
    })
})

describe('_getOfferingID', () => {
    it('returns offering id when found', async () => {
        axios.mockResolvedValue({
            data: { items: [{ id: 'offering-id' }] }
        })
        const result = await _getOfferingID('https://sm.example.com', 'token')
        expect(result).toBe('offering-id')
    })

    it('logs debug and returns undefined if not found', async () => {
        axios.mockResolvedValue({ data: { items: [{}] } })
        const result = await _getOfferingID('https://sm.example.com', 'token')
        expect(result).toBeUndefined()
        expect(logConfig.debug).toHaveBeenCalledWith(
            'Object store service offering not found in Service Manager',
            expect.objectContaining({ sm_url: 'https://sm.example.com' })
        )
    })
})

describe('_getPlanID', () => {
    it('returns plan id for supported plan', async () => {
        axios.mockResolvedValueOnce({ data: { items: [{ id: 'plan-id' }] } })
        const result = await _getPlanID('https://sm.example.com', 'token', 'offering-id')
        expect(result).toBe('plan-id')
        expect(logConfig.debug).toHaveBeenCalledWith(
            'Using object store plan',
            expect.objectContaining({ planName: expect.any(String), planID: 'plan-id' })
        )
    })

    it('throws error if no supported plan found', async () => {
        axios.mockResolvedValue({ data: { items: [{}] } })
        await expect(_getPlanID('https://sm.example.com', 'token', 'offering-id'))
            .rejects.toThrow(/No supported object store service plan found/)
        expect(logConfig.debug).toHaveBeenCalledWith(
            'No supported object store service plan found in Service Manager',
            expect.objectContaining({ sm_url: 'https://sm.example.com', attempted: expect.any(String) })
        )
    })

    it('logs error if axios throws', async () => {
        axios.mockRejectedValue(new Error('API error'))

        await expect(_getPlanID('https://sm.example.com', 'token', 'offering-id'))
            .rejects.toThrow(/No supported object store service plan found/)
        expect(logConfig.withSuggestion).toHaveBeenCalledWith(
            'error',
            expect.stringContaining('Failed to fetch plan'),
            expect.any(Error),
            expect.any(String),
            expect.objectContaining({ sm_url: 'https://sm.example.com', offeringID: 'offering-id', planName: expect.any(String) })
        )
    })
})

describe('_createObjectStoreInstance', () => {
    it('returns instance id when creation succeeds', async () => {
        axios.post.mockResolvedValue({
            headers: { location: '/v1/service_instances/instance-id' }
        })
        // Mock _pollUntilDone to return expected data
        const pollResult = { data: { resource_id: 'instance-id' } }
        jest.spyOn(require('../../lib/mtx/server'), '_pollUntilDone').mockResolvedValue(pollResult)
        const result = await _createObjectStoreInstance('https://sm.example.com', 'tenant1', 'plan-id', 'token')
        expect(result).toBe('instance-id')
    })

    it('logs error and returns undefined if axios throws', async () => {
        axios.post.mockRejectedValue(new Error('API error'))
        const result = await _createObjectStoreInstance('https://sm.example.com', 'tenant1', 'plan-id', 'token')
        expect(result).toBeUndefined()
        expect(logConfig.withSuggestion).toHaveBeenCalledWith(
            'error',
            expect.stringContaining('Failed to create object store instance for tenant'),
            expect.any(Error),
            expect.any(String),
            expect.objectContaining({ sm_url: 'https://sm.example.com', tenant: 'tenant1', planID: 'plan-id' })
        )
    })
})


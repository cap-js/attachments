let mockAttachmentsSrv, key, req = {};

jest.mock('@sap/cds', () => ({
  ql: { UPDATE: jest.fn(() => ({ with: jest.fn() })) },
  debug: jest.fn(),
  Service: class {},
    connect: { 
    to: () => Promise.resolve(mockAttachmentsSrv)
  },
  env: { requires: {} }
}));

global.fetch = jest.fn(() => Promise.resolve({
  json: () => Promise.resolve({ malwareDetected: false })
}));

jest.mock('axios');

jest.mock('../../lib/malwareScanner', () => ({
  ...jest.requireActual('../../lib/malwareScanner'),
  getCredentials: jest.fn(() => ({
    uri: 'scanner.example.com',
    username: 'user',
    password: 'pass'
  })),
  streamToString: jest.fn(() => Promise.resolve('file-content'))
}));

const { scanRequest } = require('../../lib/malwareScanner');
const { getObjectStoreCredentials, fetchToken } = require('../../lib/helper');
const axios = require('axios');
const AttachmentsService = require('../../lib/basic');
const cds = require('@sap/cds');
const { Readable } = require('stream');

beforeEach(() => {
  jest.clearAllMocks();
  mockAttachmentsSrv = {
    get: jest.fn(() => {
      const stream = new Readable();
      stream.push('test content');
      stream.push(null);
      return Promise.resolve(stream);
    }),
    update: jest.fn(() => Promise.resolve()),
    deleteInfectedAttachment: jest.fn(() => Promise.resolve()),
    getStatus: jest.fn(() => { console.log('getStatus called'); return Promise.resolve('Clean'); }),
    put: jest.fn(() => { console.log('put called'); return Promise.resolve(); }),
  };
  cds.env = { requires: { malwareScanner: { credentials: {} }, attachments: { scan: true } }, profiles: [] };
  global.fetch = jest.fn(() => Promise.resolve({
    json: () => Promise.resolve({ malwareDetected: false })
  }));
  key = { ID: 'test-id' };
  req = {};
});

describe('scanRequest', () => {
  it('should update status to "Scanning" and "Clean" if no malware detected', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ malwareDetected: false })
      })
    );
    await scanRequest({ name: 'Attachments' }, key, req);
    expect(mockAttachmentsSrv.update).toHaveBeenCalled();
    expect(mockAttachmentsSrv.deleteInfectedAttachment).not.toHaveBeenCalled();
  });

  it('should update status to "Infected" and delete content if malware detected', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        json: () => Promise.resolve({ malwareDetected: true })
      })
    );
    await scanRequest({ name: 'Attachments' }, key, req);
    expect(mockAttachmentsSrv.deleteInfectedAttachment).toHaveBeenCalled();
    expect(mockAttachmentsSrv.update).toHaveBeenCalled();
  });

  it('should update status to "Failed" if fetch throws', async () => {
    global.fetch = jest.fn(() => { throw new Error('Network error'); });
    await scanRequest({ name: 'Attachments' }, key, req);
    expect(mockAttachmentsSrv.update).toHaveBeenCalledWith(expect.anything(), key, { status: 'Failed' });
  });

  it('should handle missing credentials gracefully', async () => {
    const Attachments = {};
    const key = {};
    cds.env = { requires: {} };
    await expect(scanRequest(Attachments, key)).rejects.toThrow('SAP Malware Scanning service is not bound.');
  });
});

describe('getObjectStoreCredentials', () => {
  it('should return credentials from service manager', async () => {
    axios.get.mockResolvedValue({ data: { items: [{ id: 'test-cred' }] } });
    const creds = await getObjectStoreCredentials('tenant', 'url', 'token');
    expect(creds.id).toBe('test-cred');
  });

  it('should handle error gracefully', async () => {
    axios.get.mockRejectedValue(new Error('fail'));
    const creds = await getObjectStoreCredentials('tenant', 'url', 'token');
    expect(creds).toBeUndefined();
  });
});

describe('fetchToken', () => {
  it('should return a token when axios resolves', async () => {
    axios.post.mockResolvedValue({ data: { access_token: 'test-token' } });
    const token = await fetchToken('url', 'clientId', 'clientSecret');
    expect(token).toBe('test-token');
  });

  it('should handle error and throw', async () => {
    axios.post.mockRejectedValue(new Error('fail'));
    await expect(fetchToken('url', 'clientId', 'clientSecret')).rejects.toThrow('fail');
  });
});

describe('AttachmentsService', () => {
  let service;
  beforeEach(() => {
    service = new AttachmentsService();
  });

  it('deleteInfectedAttachment should call UPDATE with content null', async () => {
    const Attachments = {};
    const key = {};
    await service.deleteInfectedAttachment(Attachments, key);
    expect(cds.ql.UPDATE).toHaveBeenCalledWith(Attachments, key);
  });
});
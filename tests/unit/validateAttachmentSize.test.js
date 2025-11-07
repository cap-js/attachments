const { validateAttachmentSize } = require('../../lib/genericHandlers')
const cds = require('@sap/cds');
const path = require("path")
const app = path.resolve(__dirname, "../incidents-app")
const { expect } = require("@cap-js/cds-test")(app)
const spies = require('chai-spies');
const chai = require('chai');
chai.use(spies);

describe('validateAttachmentSize', () => {
  let req // Define a mock request object

  beforeEach(() => {
    req = {
      headers: {},
      target: cds.model.definitions['ProcessorService.Incidents'].elements.attachments._target,
      reject: jest.fn(), // Mocking the reject function
    }
  })

  it('should pass validation for a file size under 400 MB', () => {
    req.headers['content-length'] = '51200765'
    const rejectFunction = chai.spy.on(req, 'reject');

    validateAttachmentSize(req)

    expect(rejectFunction).not.to.have.been.called()
  })

  it('should reject for a file size over 400 MB', () => {
    req.headers['content-length'] = '20480000000'
    const rejectFunction = chai.spy.on(req, 'reject');
    validateAttachmentSize(req)

    expect(rejectFunction).to.have.been.called.with(403, 'File Size limit exceeded beyond 400 MB.')
  })

  it('should reject when content-length header is missing', () => {
    const rejectFunction = chai.spy.on(req, 'reject');
    validateAttachmentSize(req)

    expect(rejectFunction).to.have.been.called.with(403, 'Invalid Content Size')
  })
})


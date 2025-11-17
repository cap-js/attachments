const { validateAttachmentSize } = require('../../lib/generic-handlers')
require('../../lib/csn-runtime-extension')
const cds = require('@sap/cds');
const path = require("path")
const app = path.resolve(__dirname, "../incidents-app")
require("@cap-js/cds-test")(app)

describe('validateAttachmentSize', () => {
  let req // Define a mock request object

  beforeEach(() => {
    req = {
      headers: {},
      data: {content: 'abc'},
      target: cds.model.definitions['ProcessorService.Incidents'].elements.attachments._target,
      reject: jest.fn(), // Mocking the reject function
    }
  })

  it('should pass validation for a file size under 400 MB', () => {
    req.headers['content-length'] = '51200765'

    validateAttachmentSize(req)

    expect(req.reject).not.toHaveBeenCalled()
  })

  it('should reject for a file size over 400 MB', () => {
    req.headers['content-length'] = '20480000000'
    validateAttachmentSize(req)

    expect(req.reject).toHaveBeenCalledWith(400, 'AttachmentSizeExceeded')
  })

  it('should reject when content-length header is missing', () => {
    validateAttachmentSize(req)

    expect(req.reject).toHaveBeenCalledWith(400, 'InvalidContentSize')
  })
})


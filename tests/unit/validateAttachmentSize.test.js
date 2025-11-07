const { validateAttachmentSize } = require('../../lib/plugin')

describe('validateAttachmentSize', () => {
  let req // Define a mock request object

  beforeEach(() => {
    req = {
      headers: {},
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

    expect(req.reject).toHaveBeenCalledWith(400, 'File Size limit exceeded beyond 400 MB.')
  })

  it('should reject when content-length header is missing', () => {
    validateAttachmentSize(req)

    expect(req.reject).toHaveBeenCalledWith(400, 'Invalid Content Size')
  })
})


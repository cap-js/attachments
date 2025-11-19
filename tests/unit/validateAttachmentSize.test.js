require('../../lib/csn-runtime-extension')
const cds = require('@sap/cds');
const path = require("path")
const app = path.resolve(__dirname, "../incidents-app")
const { axios } = require("@cap-js/cds-test")(app)
const fs = require('fs/promises')
const { Readable } = require('stream')

let incidentID = "3ccf474c-3881-44b7-99fb-59a2a4668418"

describe('validateAttachmentSize', () => {
  axios.defaults.auth = { username: "alice" }

  it('should pass validation for a file size under 400 MB', async () => {
    const responseCreate = await axios.post(
      `/odata/v4/admin/Incidents(${incidentID})/attachments`,
      { filename: 'sample.pdf' },
      { headers: { "Content-Type": "application/json" } }
    )

    const fileContent = await fs.readFile(
      path.join(__dirname, "..", "integration", 'content/sample.pdf')
    )
    const response = await axios.put(
      `/odata/v4/admin/Incidents(${incidentID})/attachments(up__ID=${incidentID},ID=${responseCreate.data.ID})/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length,
        },
      }
    )

    expect(response.status).toEqual(204)
  })

  it('should reject for a file size over 400 MB', async () => {
    const responseCreate = await axios.post(
      `/odata/v4/admin/Incidents(${incidentID})/attachments`,
      { filename: 'large-sample.pdf' },
      { headers: { "Content-Type": "application/json" } }
    )

    const largePDFStream = generateLargePDFStream(401)
    
    await axios.put(
      `/odata/v4/admin/Incidents(${incidentID})/attachments(up__ID=${incidentID},ID=${responseCreate.data.ID})/content`,
      largePDFStream,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": 401 * 1024 * 1024,
        },
      }
    ).catch(e => {
      // REVISIT: why axios does not show 413. With Chrome 413 is correctly shown
      
    })
    cds.env.requires.attachments.scan = false
    const content = await axios.get(`/odata/v4/admin/Incidents(${incidentID})/attachments(up__ID=${incidentID},ID=${responseCreate.data.ID})/content`);
    expect(content.status).toEqual(204);
    cds.env.requires.attachments.scan = true
  })

  it('should reject for a file size specified via @Validation.Maximum', async () => {
    const responseCreate = await axios.post(
      `/odata/v4/admin/Incidents(${incidentID})/hiddenAttachments`,
      { filename: 'large-sample.pdf' },
      { headers: { "Content-Type": "application/json" } }
    )

    const largePDFStream = generateLargePDFStream(21)
    
    await axios.put(
      `/odata/v4/admin/Incidents(${incidentID})/hiddenAttachments(up__ID=${incidentID},ID=${responseCreate.data.ID})/content`,
      largePDFStream,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": 21 * 1024 * 1024,
        },
      }
    ).catch(e => {
      // REVISIT: why axios does not show 413. With Chrome 413 is correctly shown
      
    })
    cds.env.requires.attachments.scan = false
    const content = await axios.get(`/odata/v4/admin/Incidents(${incidentID})/hiddenAttachments(up__ID=${incidentID},ID=${responseCreate.data.ID})/content`);
    expect(content.status).toEqual(204);
    cds.env.requires.attachments.scan = true
  })

  it('file is removed by malware scanner when size limit is reached', async () => {
    const responseCreate = await axios.post(
      `/odata/v4/admin/Incidents(${incidentID})/attachments`,
      { filename: 'large-sample.pdf' },
      { headers: { "Content-Type": "application/json" } }
    )

    const largePDFStream = generateLargePDFStream(200)

    cds.model.definitions['AdminService.Incidents.attachments'].elements.content['@Validation.Maximum'] = 201 * 1024 * 1024
    const AdminService = await cds.connect.to('AdminService');
    AdminService.prepend(() => AdminService.on('PUT', (req, next) => {
      if (req.target.elements.content?.['@Validation.Maximum'] === 201 * 1024 * 1024) {
        cds.model.definitions['AdminService.Incidents.attachments'].elements.content['@Validation.Maximum'] = 199 * 1024 * 1024
      }
      return next()
    }))

    const upload = await axios.put(
      `/odata/v4/admin/Incidents(${incidentID})/attachments(up__ID=${incidentID},ID=${responseCreate.data.ID})/content`,
      largePDFStream,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": 200 * 1024 * 1024,
        },
      }
    )

    expect(upload.status).toEqual(204);

    const metadata = await axios.get(`/odata/v4/admin/Incidents(${incidentID})/attachments(up__ID=${incidentID},ID=${responseCreate.data.ID})`);
    expect(metadata.status).toEqual(200);
    expect(metadata.data.status).toEqual('Failed');
    cds.env.requires.attachments.scan = false
    const content = await axios.get(`/odata/v4/admin/Incidents(${incidentID})/attachments(up__ID=${incidentID},ID=${responseCreate.data.ID})/content`);
    expect(content.status).toEqual(204);
    cds.env.requires.attachments.scan = true
    cds.model.definitions['AdminService.Incidents.attachments'].elements.content['@Validation.Maximum'] = 400 * 1024 * 1024
  })
})


function generateLargePDFStream(sizeInMB = 401) {
  const targetSize = sizeInMB * 1024 * 1024;
  const pdfHeader = Buffer.from('%PDF-1.4\n');
  const pdfContent = Buffer.from('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  const pdfTrailer = Buffer.from('%%EOF\n');
  
  const headerAndTrailerSize = pdfHeader.length + pdfTrailer.length;
  const paddingNeeded = targetSize - headerAndTrailerSize - pdfContent.length;
  
  const chunkSize = 1024 * 1024;
  
  return Readable.from((async function* () {
    yield pdfHeader;
    
    yield pdfContent;
    
    // Yield padding in chunks
    let remaining = paddingNeeded;
    while (remaining > 0) {
      const size = Math.min(chunkSize, remaining);
      yield Buffer.alloc(size, ' ');
      remaining -= size;
    }
    yield pdfTrailer;
  })());
}
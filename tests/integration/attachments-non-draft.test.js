const path = require("path");
const fs = require("fs");
const cds = require("@sap/cds");
const { commentAnnotation, uncommentAnnotation } = require("../utils/modify-annotation");

const servicesCdsPath = path.resolve(__dirname, '../incidents-app/srv/services.cds');
const annotationsCdsPath = path.resolve(__dirname, '../incidents-app/app/incidents/annotations.cds');
const linesToComment = [
  'annotate ProcessorService.Incidents with @odata.draft.enabled;',
  'annotate service.Incidents with @odata.draft.enabled;'
];

beforeAll(async () => {
  await commentAnnotation(servicesCdsPath, linesToComment);
  await commentAnnotation(annotationsCdsPath, linesToComment);
});

const app = path.resolve(__dirname, "../incidents-app");
const { expect, axios } = require("@cap-js/cds-test")(app);

axios.defaults.auth = { username: "alice" };
jest.setTimeout(5 * 60 * 1000);

let attachmentID = null;
let incidentID = "3ccf474c-3881-44b7-99fb-59a2a4668418";

afterAll(async () => {
  await uncommentAnnotation(servicesCdsPath, linesToComment);
  await uncommentAnnotation(annotationsCdsPath, linesToComment);
});

describe("Tests for uploading/deleting and fetching attachments through API calls with non draft mode", () => {
  beforeAll(async () => {
    cds.env.requires.db.kind = "sql";
    cds.env.requires.attachments.kind = "db";
    await cds.connect.to("sql:my.db");
    await cds.connect.to("attachments");
    cds.env.requires.attachments.scan = false;
    cds.env.profiles = ["development"];
  });

  it("should create attachment metadata", async () => {
    const response = await axios.post(
      `/odata/v4/processor/Incidents(${incidentID})/attachments`,
      { filename: "sample.pdf" },
      { headers: { "Content-Type": "application/json" } }
    );
    expect(response.status).to.equal(201);
    expect(response.data).to.have.property("ID");
    attachmentID = response.data.ID;
  });

  it("should upload attachment content", async () => {
    const fileContent = fs.readFileSync(path.join(__dirname, 'content/sample.pdf'));
    const response = await axios.put(
      `/odata/v4/processor/Incidents(${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})/content`,
      fileContent,
      {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Length": fileContent.length
        }
      }
    );
    expect(response.status).to.equal(204);
  });

  it("should list attachments for incident", async () => {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const response = await axios.get(
      `/odata/v4/processor/Incidents(ID=${incidentID})/attachments`
    );
    expect(response.status).to.equal(200);
    expect(response.data.value[0].up__ID).to.equal(incidentID);
    expect(response.data.value[0].filename).to.equal("sample.pdf");
    expect(response.data.value[0].content).to.be.undefined;
    expect(response.data.value[0].ID).to.equal(attachmentID);
    expect(response.data.value[0].status).to.equal("Clean");
  });

  it("Fetching the content of the uploaded attachment", async () => {
    const response = await axios.get(
      `/odata/v4/processor/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})/content`,
      { responseType: 'arraybuffer' }
    );
    expect(response.status).to.equal(200);
    expect(response.data).to.exist;
    expect(response.data.length).to.be.greaterThan(0);

    const originalContent = fs.readFileSync(path.join(__dirname, 'content/sample.pdf'));
    expect(Buffer.compare(response.data, originalContent)).to.equal(0);
  });

  it("Deleting the uploaded attachment", async () => {
    const response = await axios.delete(
      `/odata/v4/processor/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})`
    );
    expect(response.status).to.equal(204);
  });

  it("Verifying the attachment is deleted", async () => {
    try {
      await axios.get(
        `/odata/v4/processor/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})`
      );
    } catch (err) {
      expect(err.response.status).to.equal(404);
    }
  });
});

const cds = require("@sap/cds");
const path = require("path");
const app = path.resolve(__dirname, "../incidents-app-non-draft");
const { expect, axios } = cds.test(app);
const { createReadStream } = cds.utils.fs;
const { join } = cds.utils.path;

axios.defaults.auth = { username: "alice" };
jest.setTimeout(5 * 60 * 1000);

let sampleDocID = null;
let incidentID = null;

describe("Tests for uploading/deleting and fetching attachments through API calls with non draft mode", () => {
  beforeAll(async () => {
    cds.env.requires.db.kind = "sql";
    cds.env.requires.attachments.kind = "db";
    await cds.connect.to("sql:my.db");
    await cds.connect.to("attachments");
    cds.env.requires.attachments.scan = false;
    cds.env.profiles = ["development"];
    sampleDocID = null;
    incidentID = "3ccf474c-3881-44b7-99fb-59a2a4668418";
  });

  it("Uploading attachment in non-draft mode", async () => {
    try {
      const response = await axios.post(
        `/odata/v4/processor/Incidents(ID=${incidentID})/attachments`,
        {
          up__ID: incidentID,
          filename: "sample.pdf",
          mimeType: "application/pdf",
          content: createReadStream(join(__dirname, "content/sample.pdf")),
        },
        { headers: { "Content-Type": "application/json" } }
      );
      expect(response.status).to.equal(201);
      expect(response.data).to.have.property("ID");
      sampleDocID = response.data.ID; // Save the ID for later use
    } catch (err) {
      expect(err).to.be.undefined;
    }
  });

  // Fetch the uploaded attachment
  it("Fetching the uploaded attachment", async () => {
    try {
      const response = await axios.get(
        `/odata/v4/processor/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${sampleDocID})`
      );
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("ID", sampleDocID);
      expect(response.data).to.have.property("filename", "sample.pdf");
      expect(response.data).to.have.property("mimeType", "application/pdf");
    } catch (err) {
      expect(err).to.be.undefined;
    }
  });

 // Fetch the content of the uploaded attachment
  it("Fetching the content of the uploaded attachment", async () => {
    try {
      const response = await axios.get(
        `/odata/v4/processor/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${sampleDocID})/content`
      );
      expect(response.status).to.equal(200);
      expect(response.data).to.exist; // Ensure content is returned
    } catch (err) {
      expect(err).to.be.undefined;
    }
  });

  // Delete the uploaded attachment
  it("Deleting the uploaded attachment", async () => {
    try {
      const response = await axios.delete(
        `/odata/v4/processor/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${sampleDocID})`
      );
      expect(response.status).to.equal(204); // No content response for successful deletion
    } catch (err) {
      expect(err).to.be.undefined;
    } 
  });

  // Verify the attachment is deleted
  it("Verifying the attachment is deleted", async () => {
    try {
      await axios.get(
        `/odata/v4/processor/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${sampleDocID})`
      );
    } catch (err) {
      expect(err.response.status).to.equal(404); // Not found after deletion
    }
  });
});


  
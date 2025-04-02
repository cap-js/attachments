const cds = require("@sap/cds");
const path = require("path");
const app = path.resolve(__dirname, "../incidents-app-non-draft");
const { expect, axios } = require("@cap-js/cds-test")(app);
const fs = require('fs');

axios.defaults.auth = { username: "alice" };
jest.setTimeout(5 * 60 * 1000);

let attachmentID = null;
let incidentID = null;

describe("Tests for uploading/deleting and fetching attachments through API calls with non draft mode", () => {
  beforeAll(async () => {
    cds.env.requires.db.kind = "sql";
    cds.env.requires.attachments.kind = "db";
    await cds.connect.to("sql:my.db");
    await cds.connect.to("attachments");
    cds.env.requires.attachments.scan = false;
    cds.env.profiles = ["development"];
    attachmentID = null;
    incidentID = "3ccf474c-3881-44b7-99fb-59a2a4668418";
  });
  // Create attachment metadata
  it("should create attachment metadata", async () => {
    try {
      const response = await axios.post(
        `/odata/v4/processor/Incidents(${incidentID})/attachments`,
        {
          filename: "sample.pdf"
        },
        { headers: { "Content-Type": "application/json" }}
      );
      expect(response.status).to.equal(201);
      expect(response.data).to.have.property("ID");
      attachmentID = response.data.ID;
    } catch (err) {
      expect(err).to.be.undefined;
    }
  });

  // Upload attachment content
  it("should upload attachment content", async () => {
    try {
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
    } catch (err) {
      expect(err).to.be.undefined;
    }
  });  

  // Get list of attachments for the incident
  it("should list attachments for incident", async () => {
    try {
      //Mocking scanning timer for at least 5 seconds
      await new Promise(resolve => setTimeout(resolve, 5000));
      const response = await axios.get(
        `/odata/v4/processor/Incidents(ID=${incidentID})/attachments`
      );
      expect(response.status).to.equal(200);
      expect(response.data.value[0].up__ID).to.equal(incidentID);
      expect(response.data.value[0].filename).to.equal("sample.pdf");
      expect(response.data.value[0].content).to.be.undefined; // Content should not be fetched
      expect(response.data.value[0].ID).to.equal(attachmentID);
      expect(response.data.value[0].status).to.equal("Clean"); // Checking scan status
    } catch (err) {
      expect(err).to.be.undefined;
    }
  });

 // Fetch the content of the uploaded attachment
  it("Fetching the content of the uploaded attachment", async () => {
    try {
      const response = await axios.get(
        `/odata/v4/processor/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})/content`
      );
      expect(response.status).to.equal(200);
      expect(response.data).to.exist; // Ensure content is returned

      // Verify content exists and is not empty
      expect(response.data).to.not.be.null;
      expect(response.data).to.not.be.undefined;
      expect(response.data.length).to.be.greaterThan(0);

      // Compare with original file content
      const originalContent = fs.readFileSync(path.join(__dirname, 'content/sample.pdf'), 'utf8');
      expect(response.data).to.equal(originalContent);
      
    } catch (err) {
      expect(err).to.be.undefined;
    }
  });

  // Delete the uploaded attachment
  it("Deleting the uploaded attachment", async () => {
    try {
      const response = await axios.delete(
        `/odata/v4/processor/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})`
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
        `/odata/v4/processor/Incidents(ID=${incidentID})/attachments(up__ID=${incidentID},ID=${attachmentID})`
      );
    } catch (err) {
      expect(err.response.status).to.equal(404); // Not found after deletion
    }
  });
});


  
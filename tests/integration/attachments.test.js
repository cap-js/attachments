const cds = require("@sap/cds");
const path = require("path");
const app = path.resolve(__dirname, "../incidents-app");
const { expect, axios, GET, POST, DELETE } = cds.test(app);
const { RequestSend } = require("../utils/api");
const { createReadStream } = cds.utils.fs;
const { join } = cds.utils.path;

axios.defaults.auth = { username: "alice" };
jest.setTimeout(5 * 60 * 1000);

let utils = null;
let sampleDocID = null;
let incidentID = null;
let db = null;
let attachmentsService = null;

describe("Tests for uploading/deleting attachments through API calls - in-memory db", () => {
  beforeAll(async () => {
    cds.env.requires.db.kind = "sql";
    cds.env.requires.attachments.kind = "db";
    db = await cds.connect.to("sql:my.db");
    attachmentsService = await cds.connect.to("attachments");
    cds.env.requires.attachments.scan = false;
    cds.env.profiles = ["development"];
    sampleDocID = null;
    incidentID = "3ccf474c-3881-44b7-99fb-59a2a4668418";
    utils = new RequestSend(POST);
  });
  //Draft mode uploading attachment
  it("Uploading attachment in draft mode with scanning enabled", async () => {
    //function to upload attachment
    let action = await POST.bind(
      {},
      `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=false)/attachments`,
      {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/pdf",
        content: createReadStream(join(__dirname, "content/sample.pdf")),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
      }
    );

    try {
      //trigger to upload attachment
      await utils.draftModeActions(
        "processor",
        "Incidents",
        incidentID,
        "ProcessorService",
        action
      );
    } catch (err) {
      expect(err).to.be.undefined;
    }

    //read attachments list for Incident
    try {
      const response = await GET(
        `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`
      );
      //the data should have only one attachment
      expect(response.status).to.equal(200);
      expect(response.data.value.length).to.equal(1);
      //to make sure content is not read
      expect(response.data.value[0].content).to.be.undefined;
      sampleDocID = response.data.value[0].ID;
    } catch (err) {
      expect(err).to.be.undefined;
    }

    //read attachment in active table
    try {
      const response = await GET(
        `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`
      );
      expect(response.status).to.equal(200);
      expect(response.data).to.not.be.undefined;
    } catch (err) {
      expect(err).to.be.undefined;
    }


    // Check Scanning status
    try {
      const response = await GET(
        `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`
      );
      expect(response.status).to.equal(200);
      expect(response.data.value.length).to.equal(1);
      expect(response.data.value[0].status).to.equal("Scanning"); // Initial status should be Scanning
      
    } catch (err) {
      
      expect(err).to.be.undefined;
    }

    //Mocking scanning timer for at least 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000));

    //Check clean status
    try {
      const response = await GET(
        `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`
      );
      expect(response.status).to.equal(200);
      expect(response.data.value.length).to.equal(1);
      expect(response.data.value[0].status).to.equal("Clean"); 
    } catch (err) {
      expect(err).to.be.undefined;
    }
  });

  //Deleting the attachment
  it("Deleting the attachment", async () => {
    //check the content of the uploaded attachment in main table
    try {
      const response = await GET(
        `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`
      );
      expect(response.status).to.equal(200);
    } catch (err) {
      expect(err).to.be.undefined;
    }
    //delete attachment
    let action = await DELETE.bind(
      {},
      `odata/v4/processor/Incidents_attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=false)`
    );
    try {
      //trigger to delete attachment
      await utils.draftModeActions(
        "processor",
        "Incidents",
        incidentID,
        "ProcessorService",
        action
      );
    } catch (err) {
      expect(err).to.be.undefined;
    }

    //read attachments list for Incident
    try {
      const response = await GET(
        `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments`
      );
      //the data should have no attachments
      expect(response.status).to.equal(200);
      expect(response.data.value.length).to.equal(0);
    } catch (err) {
      expect(err).to.be.undefined;
    }

    //content should not be there
    try {
      const response = await GET(
        `odata/v4/processor/Incidents(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleDocID},IsActiveEntity=true)/content`
      );
    } catch (err) {
      expect(err.code).to.equal("ERR_BAD_REQUEST");
    }
  });
});

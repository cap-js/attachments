const cds = require("@sap/cds");
const incidentsApp = require("path").resolve(__dirname, "./../../xmpl");
const { expect, data, axios, GET, POST, PATCH, DELETE } =
  cds.test(incidentsApp);
const { RequestSend } = require("../utils/api");
const { createReadStream } = cds.utils.fs;

axios.defaults.auth = { username: "alice" };
jest.setTimeout(5 * 60 * 1000);

describe("Tests for Attachments - mock data and xmpl in-memory database", () => {
  let attachmentsSrv = null;
  let utils = null;
  beforeAll(async () => {
    attachmentsSrv = await cds.connect.to("attachments");
    utils = new RequestSend(POST);
  });

  //Reading the uploaded attachment content and that it exists - Inverter Fault Report.pdf
  it("Reading the uploaded attachment document", async () => {
    //checking the uploaded attachment document
    try {
      const response = await GET(
        "odata/v4/processor/Incidents(ID=3b23bb4b-4ac7-4a24-ac02-aa10cabd842c,IsActiveEntity=true)/attachments(up__ID=3b23bb4b-4ac7-4a24-ac02-aa10cabd842c,filename='INVERTER%20FAULT%20REPORT.pdf',IsActiveEntity=true)/content"
      );
      expect(response.status).to.equal(200);
    } catch (err) {
      console.log(err);
    }
  });

  //Reading the uploaded attachment content image and that it exists - Broken solar panel.jpg
  it("Reading the uploaded attachment image", async () => {
    //checking the uploaded attachment document
    try {
      const response = await GET(
        "odata/v4/processor/Incidents(ID=3583f982-d7df-4aad-ab26-301d4a157cd7,IsActiveEntity=true)/attachments(up__ID=3583f982-d7df-4aad-ab26-301d4a157cd7,filename='Broken%20Solar%20Panel.jpg',IsActiveEntity=true)/content"
      );
      expect(response.status).to.equal(200);
    } catch (err) {
      console.log(err);
    }
  });

  //Reading the attachment list and checking for content
  it("Reading attachments list", async () => {
    //read attachments list for Incident - Inverter not functional
    try {
      const response = await GET(
        "odata/v4/processor/Incidents(ID=3b23bb4b-4ac7-4a24-ac02-aa10cabd842c,IsActiveEntity=true)/attachments"
      );
      //the mock data has two attachments
      expect(response.status).to.equal(200);
      expect(response.data.value.length).to.equal(2);
      //to make sure content is not read
      expect(response.data.value[0].content).to.be.undefined;
    } catch (err) {
      console.log(err);
    }
  });
});

describe("Tests for Attachments - sample application in-memory database", () => {
  let attachmentsSrv = null;
  let utils = null;
  beforeAll(async () => {
    attachmentsSrv = await cds.connect.to("attachments");
    utils = new RequestSend(POST);
  });

  //Draft mode uploading attachment
  it("Uploading image in draft mode", async () => {
    //function to upload image
    let action = await POST.bind(
      {},
      `odata/v4/processor/Incidents(ID=3a4ede72-244a-4f5f-8efa-b17e032d01ee,IsActiveEntity=false)/attachments`,
      {
        up__ID: "3a4ede72-244a-4f5f-8efa-b17e032d01ee",
        filename: "strange-noise.csv",
        mimeType: "text/csv",
        content: createReadStream(
          "/Users/I543676/Desktop/Setup/calesi/plugins/attachments/xmpl/db/content/strange-noise.csv"
        ),
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ),
        createdBy: "alice",
      }
    );
    //trigger to upload attachment
    await utils.apiAction(
      "processor",
      "Incidents",
      "3a4ede72-244a-4f5f-8efa-b17e032d01ee",
      "ProcessorService",
      action
    );
    //read attachment in active table
    try {
      const response = await GET(
        "odata/v4/processor/Incidents(ID=3a4ede72-244a-4f5f-8efa-b17e032d01ee,IsActiveEntity=true)/attachments(up__ID=3a4ede72-244a-4f5f-8efa-b17e032d01ee,filename='strange-noise.csv',IsActiveEntity=true)/content"
      );
      expect(response.status).to.equal(200);
    } catch (err) {
      console.log(err);
    }

    //read attachments list for Incident - No current on a sunny day
    try {
      const response = await GET(
        "odata/v4/processor/Incidents(ID=3a4ede72-244a-4f5f-8efa-b17e032d01ee,IsActiveEntity=true)/attachments"
      );
      //the data should have two attachments
      expect(response.status).to.equal(200);
      expect(response.data.value.length).to.equal(2);
      //to make sure content is not read
      expect(response.data.value[0].content).to.be.undefined;
    } catch (err) {
      console.log(err);
    }
  });

  //Deleting the attachment
  it("Deleting the attachment", async () => {
    //check the url of the uploaded attachment in main table
    try {
      const response = await GET(
        "odata/v4/processor/Incidents(ID=3a4ede72-244a-4f5f-8efa-b17e032d01ee,IsActiveEntity=true)/attachments(up__ID=3a4ede72-244a-4f5f-8efa-b17e032d01ee,filename='strange-noise.csv',IsActiveEntity=true)/content"
      );
      expect(response.status).to.equal(200);
    } catch (err) {
      console.log(err);
    }

    try {
      const response = await GET(
        "odata/v4/processor/Incidents(ID=3a4ede72-244a-4f5f-8efa-b17e032d01ee,IsActiveEntity=true)/attachments"
      );
      //the data should have two attachments
      expect(response.status).to.equal(200);
      expect(response.data.value.length).to.equal(2);
      //to make sure content is not read
      expect(response.data.value[0].content).to.be.undefined;
    } catch (err) {
      console.log(err);
    }

    //delete attachment
    try {
      let action = await DELETE.bind(
        {},
        `odata/v4/processor/Incidents_attachments(up__ID=3a4ede72-244a-4f5f-8efa-b17e032d01ee,filename='strange-noise.csv',IsActiveEntity=false)`
      );
      //trigger to upload attachment
      await utils.apiAction(
        "processor",
        "Incidents",
        "3a4ede72-244a-4f5f-8efa-b17e032d01ee",
        "ProcessorService",
        action
      );
    } catch (err) {
      console.log(err);
    }

    try {
      const response = await GET(
        "odata/v4/processor/Incidents(ID=3a4ede72-244a-4f5f-8efa-b17e032d01ee,IsActiveEntity=true)/attachments"
      );
      //the data should have two attachments
      expect(response.status).to.equal(200);
      expect(response.data.value.length).to.equal(1);
      //to make sure content is not read
      expect(response.data.value[0].content).to.be.undefined;
    } catch (err) {
      console.log(err);
    }
  });
});

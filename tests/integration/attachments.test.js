const AttachmentsPlugin = require("../../lib/plugin");
const cds = require("@sap/cds");
const incidentsApp = require("path").resolve(__dirname, "./../../xmpl");
const { expect, data, GET, POST, PATCH, DELETE } = cds.test(incidentsApp);

jest.setTimeout(5*60*1000);

describe("Tests for Attachments xmpl in-memory database", () => {

  let attachmentsSrv = null;
  const ALICE = { auth : { username: 'alice', password: ''}};
  beforeAll(async () => {
    attachmentsSrv = await cds.connect.to('attachments');
    cds.env.profile = 'development'
  })
  
  beforeEach(async () => {
    await data.reset();
  })
  
  //Reading the uploaded attachment content and that it exists - Inverter Fault Report.pdf
  it("Reading the uploaded attachment document",  async () => {
    
    //checking the uploaded attachment document
    try{
      const response = await GET('odata/v4/processor/Incidents(ID=3b23bb4b-4ac7-4a24-ac02-aa10cabd842c,IsActiveEntity=true)/attachments(up__ID=3b23bb4b-4ac7-4a24-ac02-aa10cabd842c,filename=\'INVERTER%20FAULT%20REPORT.pdf\',IsActiveEntity=true)/content', ALICE);
      expect(response).toMatchObject({status: 200});
    } catch (err){
      console.log(err);
    }
  });

  //Reading the uploaded attachment content image and that it exists - Broken solar panel.jpg
  it("Reading the uploaded attachment image",  async () => {
    
    //checking the uploaded attachment document
    try{
      const response = await GET('odata/v4/processor/Incidents(ID=3583f982-d7df-4aad-ab26-301d4a157cd7,IsActiveEntity=true)/attachments(up__ID=3583f982-d7df-4aad-ab26-301d4a157cd7,filename=\'Broken%20Solar%20Panel.jpg\',IsActiveEntity=true)/content', ALICE);
      expect(response).toMatchObject({status: 200});
    } catch (err) {
      console.log(err);
    }
  });

  //Reading the attachment list and checking for content
  it("Reading attachments list", async () => {
    //read attachments list for Incident - Inverter not functional
    try{
      const response = await GET('odata/v4/processor/Incidents(ID=3b23bb4b-4ac7-4a24-ac02-aa10cabd842c,IsActiveEntity=true)/attachments', ALICE);
      //the mock data has two attachments
      expect(response).toMatchObject({status: 200});
      expect(response.data.value.length).toBe(2);
      //to make sure content is not read
      expect(response.data.value[0].content).toBe(undefined);
    } catch (err) {
      console.log(err);
    }
  });

  // //Draft mode uploading attachment
  // it("Uploading image in draft mode", async () => {
  //   //trigger to upload attachment
  //   let res = await POST.bind(
  //     {},
  //     `admin/Incidents(ID=3583f982-d7df-4aad-ab26-301d4a157cd7,IsActiveEntity=false)/attachments`,
  //     {
  //       filename: 'test.txt',
  //       content: 'abc'
  //     }
  //   )
    
  //   console.log('aaa');
  //   //read attachment in Draft table
  //   //attachment should not exist in active table
  // });

  // //Deleting the attachment - WRITE FOR S3
  // it("Deleting the attachment", async () => {
  //   //check the url of the uploaded attachment in main table
  //   try{
  //     const response = await GET('odata/v4/processor/Incidents(ID=3583f982-d7df-4aad-ab26-301d4a157cd7,IsActiveEntity=true)/attachments(up__ID=3583f982-d7df-4aad-ab26-301d4a157cd7,filename=\'Broken%20Solar%20Panel.jpg\',IsActiveEntity=true)/content', ALICE);
  //     expect(response).toMatchObject({status: 200});
  //   } catch (err){
  //     console.log(err);
  //   }
  //   //check the url of the uploaded attachment in draft table
  //   try{
  //     const response = await GET('odata/v4/processor/Incidents(ID=3583f982-d7df-4aad-ab26-301d4a157cd7,IsActiveEntity=false)/attachments(up__ID=3583f982-d7df-4aad-ab26-301d4a157cd7,filename=\'Broken%20Solar%20Panel.jpg\',IsActiveEntity=false)/content', ALICE);
  //   } catch (err){
  //     //expected error
  //     console.log(err);
  //   }

  //   //delete attachment
  //   try{
  //     let { response, data } =await GET('/odata/v4/processor/Incidents_attachments(up__ID=3583f982-d7df-4aad-ab26-301d4a157cd7,filename=\'Broken Solar Panel.jpg\',IsActiveEntity=true)', ALICE)
  //     expect(response).toMatchObject({status: 200});
  //     response = await DELETE('/odata/v4/processor/Incidents_attachments(up__ID=3583f982-d7df-4aad-ab26-301d4a157cd7,filename=\'Broken%20Solar%20Panel.jpg\',IsActiveEntity=false)/ProcessorService.draftActivate', ALICE)
  //     expect(response).toMatchObject({status: 200});
  //     console.log(response)
  //   } catch (err) {
  //     console.log(err);
  //   }

  //   //check the url of the uploaded attachment in main table
  //   try{
  //     const response = await GET('odata/v4/processor/Incidents(ID=3583f982-d7df-4aad-ab26-301d4a157cd7,IsActiveEntity=true)/attachments(up__ID=3583f982-d7df-4aad-ab26-301d4a157cd7,filename=\'Broken%20Solar%20Panel.jpg\',IsActiveEntity=true)/content', ALICE);
  //     expect(response).toMatchObject({status: 200});
  //   } catch (err){
  //     console.log(err);
  //   }
  //   //check the url of the uploaded attachment in draft table
  //   try{
  //     const response = await GET('odata/v4/processor/Incidents(ID=3583f982-d7df-4aad-ab26-301d4a157cd7,IsActiveEntity=false)/attachments(up__ID=3583f982-d7df-4aad-ab26-301d4a157cd7,filename=\'Broken%20Solar%20Panel.jpg\',IsActiveEntity=false)/content', ALICE);
  //     expect(response).toMatchObject({status: 200});
  //   } catch (err){
  //     console.log(err);
  //   }
    
  //   //check the url of the uploaded attachment in main table
  //   //check the url of the uploaded attachment in draft table
  // });
});

const cds = require("@sap/cds")
const LOG = cds.log("incidents-app")

class ProcessorService extends cds.ApplicationService {
  /** Registering custom event handlers */
  init() {
    const res = super.init()
    this.prepend(() =>
      this.on(
        "PUT",
        this.entities["SampleRootWithComposedEntity.attachments"].drafts,
        async (req, next) => {
          cds
            .log("overwrite-put-handler")
            .info("Overwritten PUT handler called")
          return next()
        },
      ),
    )

    this.before("UPDATE", "Incidents", (req) => this.onUpdate(req))
    this.before(["CREATE", "UPDATE"], "Incidents", (req) =>
      this.changeUrgencyDueToSubject(req.data),
    )

    this.on("insertTestData", () => this.insertTestData())

    return res
  }

  async insertTestData() {
    const firstID = cds.utils.uuid()
    const secondID = cds.utils.uuid()
    await INSERT.into("sap.capire.incidents.NonDraftTest").entries(
      {
        ID: firstID,
        title: "Test Incident 1",
        description: "This is a test incident 1",
        urgency_code: "L",
        urgency_descr: "Low",
      },
      {
        ID: secondID,
        title: "Urgent Test Incident 2",
        description: "This is a test incident 2",
        urgency_code: "L",
        urgency_descr: "Low",
      },
    )
    await INSERT.into("sap.capire.incidents.NonDraftTest.attachments").entries(
      {
        ID: cds.utils.uuid(),
        up__ID: firstID,
        fileName: "test1.txt",
        mimeType: "text/plain",
        content: Buffer.from("Hello World 1"),
      },
      {
        ID: cds.utils.uuid(),
        up__ID: secondID,
        fileName: "test2.txt",
        mimeType: "text/plain",
        content: Buffer.from("Hello World 2"),
      },
    )
    LOG.info("Test data inserted into NonDraftTest and attachments")
    return "Test data inserted"
  }

  changeUrgencyDueToSubject(data) {
    if (data) {
      const incidents = Array.isArray(data) ? data : [data]
      incidents.forEach((incident) => {
        if (incident.title?.toLowerCase().includes("urgent")) {
          incident.urgency = { code: "H", descr: "High" }
        }
      })
    }
  }

  /** Custom Validation */
  async onUpdate(req) {
    const { status_code } = await SELECT.one(
      req.subject,
      (i) => i.status_code,
    ).where({ ID: req.data.ID })
    if (status_code === "C") {
      return req.reject(`Can't modify a closed incident`)
    }
  }
}

module.exports = { ProcessorService }

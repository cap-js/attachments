"use strict"
require("../../lib/csn-runtime-extension")
const cds = require("@sap/cds")
const crypto = require("crypto")
const path = require("path")
const app = path.resolve(__dirname, "../incidents-app")
cds.test(app)

const MalwareScanner = require("../../srv/malware-scanner/malwareScanner")

// ---------------------------------------------------------------------------
// Unit-level TOCTOU test: exercises updateStatus + _scanAttachmentsFile
// directly against the real SQLite DB, bypassing the HTTP layer.
// ---------------------------------------------------------------------------

let scanner

beforeEach(() => {
  jest.clearAllMocks()
  cds.env.requires.attachments = { scan: true }
  cds.env.requires.malwareScanner = {
    credentials: { uri: "host", certificate: "C", key: "K" },
  }
  jest.spyOn(cds, "context", "get").mockReturnValue({ model: cds.model })
  scanner = new MalwareScanner()
  scanner.retryConfig = {
    enabled: false,
    maxAttempts: 1,
    initialDelay: 0,
    maxDelay: 0,
  }
})

describe("TOCTOU race in scan-status update", () => {
  const target = "ProcessorService.Incidents.attachments"

  function hashOf(buf) {
    return crypto.createHash("sha256").update(buf).digest("hex")
  }

  it("baseline: updateStatus(Scanning) then updateStatus(Clean) leaves correct hash", async () => {
    const _target = cds.model.definitions[target]
    const keys = { up__ID: cds.utils.uuid(), ID: cds.utils.uuid() }
    await INSERT.into(_target).entries({
      ...keys,
      status: "Unscanned",
      filename: "baseline.txt",
    })

    const hashA = hashOf(Buffer.from("FILE-A"))

    const scanToken = await scanner.updateStatus(_target, keys, "Scanning")
    expect(typeof scanToken).toBe("string")
    expect(scanToken).toHaveLength(36)

    // Verify row shows Scanning and has scanToken set
    const scanning = await SELECT.one.from(_target).where(keys)
    expect(scanning.status).toBe("Scanning")
    expect(scanning.scanToken).toBe(scanToken)

    await scanner.updateStatus(_target, keys, "Clean", hashA)

    const row = await SELECT.one.from(_target).where(keys)
    expect(row.status).toBe("Clean")
    expect(row.hash).toBe(hashA)
  })

  it("TOCTOU race: stale scan-1 verdict must not overwrite scan-2 result", async () => {
    const _target = cds.model.definitions[target]
    const keys = { up__ID: cds.utils.uuid(), ID: cds.utils.uuid() }
    await INSERT.into(_target).entries({
      ...keys,
      status: "Unscanned",
      filename: "race.txt",
    })

    const hashA = hashOf(Buffer.from("FILE-A-CONTENT"))
    const hashB = hashOf(Buffer.from("FILE-B-CONTENT"))

    // scan-1 starts: sets scanToken-1
    const tokenScan1 = await scanner.updateStatus(_target, keys, "Scanning")

    // scan-2 starts: overwrites scanToken with tokenScan2
    const tokenScan2 = await scanner.updateStatus(_target, keys, "Scanning")

    expect(tokenScan1).not.toBe(tokenScan2)

    // scan-2 completes first with tokenField WHERE
    const tokenField = "scanToken"
    await scanner.updateStatus(
      _target,
      [
        { ref: [tokenField] },
        "=",
        { val: tokenScan2 },
        "and",
        {
          xpr: Object.keys(keys).reduce((acc, key) => {
            if (acc.length) acc.push("and")
            acc.push({ ref: [key] }, "=", { val: keys[key] })
            return acc
          }, []),
        },
      ],
      "Clean",
      hashB,
    )

    const afterScan2 = await SELECT.one.from(_target).where(keys)
    expect(afterScan2.status).toBe("Clean")
    expect(afterScan2.hash).toBe(hashB)

    // Now scan-1 completes with its (now-stale) token — must NOT overwrite
    await scanner.updateStatus(
      _target,
      [
        { ref: [tokenField] },
        "=",
        { val: tokenScan1 },
        "and",
        {
          xpr: Object.keys(keys).reduce((acc, key) => {
            if (acc.length) acc.push("and")
            acc.push({ ref: [key] }, "=", { val: keys[key] })
            return acc
          }, []),
        },
      ],
      "Clean",
      hashA,
    )

    const afterScan1LateArrival = await SELECT.one.from(_target).where(keys)
    // Bug (IS NULL): would have matched, overwriting hashB with hashA
    // Fix (token): tokenScan1 no longer matches → row unchanged
    expect(afterScan1LateArrival.hash).toBe(hashB)
    expect(afterScan1LateArrival.status).toBe("Clean")
  })

  it("_scanAttachmentsFile: scan completion uses token so stale scan cannot overwrite", async () => {
    const _target = cds.model.definitions[target]
    const keys = { up__ID: cds.utils.uuid(), ID: cds.utils.uuid() }
    await INSERT.into(_target).entries({
      ...keys,
      status: "Unscanned",
      filename: "token-test.txt",
    })

    const expectedHash = hashOf(Buffer.from("CONTENT-FOR-TOKEN-TEST"))

    // Simulate the attachment service getting the file
    const { Readable } = require("stream")
    const attachmentsSvc = {
      get: jest.fn().mockResolvedValue(Readable.from([])),
      emit: jest.fn().mockResolvedValue(undefined),
    }
    cds.connect.to = jest.fn().mockResolvedValue(attachmentsSvc)

    // Mock scan (called as this.scan(stream) by _scanWithRetry) to return a fixed hash
    scanner.scan = jest
      .fn()
      .mockResolvedValue({ isMalware: false, hash: expectedHash })

    // Intercept updateStatus to capture the token returned from the Scanning call
    let capturedToken = null
    const originalUpdateStatus = scanner.updateStatus.bind(scanner)
    let callCount = 0
    scanner.updateStatus = jest.fn(async (...args) => {
      callCount++
      const result = await originalUpdateStatus(...args)
      if (callCount === 1) {
        // First call = "Scanning": capture the returned token
        capturedToken = result
      }
      return result
    })

    await scanner._scanAttachmentsFile({ data: { target, keys } })

    const row = await SELECT.one.from(_target).where(keys)
    expect(row.status).toBe("Clean")
    expect(row.hash).toBe(expectedHash)

    // The Scanning call must have returned a token
    expect(typeof capturedToken).toBe("string")
    expect(capturedToken).toHaveLength(36)

    // Token is not cleared on completion — the DB retains which scan last wrote the verdict.
    expect(row.scanToken).toBeTruthy()
  })
})

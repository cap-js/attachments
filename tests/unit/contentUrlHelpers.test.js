"use strict"
const { isContentRequest, extractContentPrefix } = require("../../lib/helper")

describe("isContentRequest", () => {
  it.each([
    "/odata/v4/processor/Incidents(1)/attachments(ID=1)/content",
    "/odata/v4/processor/Incidents(1)/attachments(ID=1)/content/$value",
    "/odata/v4/processor/Entity(1)/foo_content",
    "/odata/v4/processor/Entity(1)/foo_content/$value",
    "content",
    "content/$value",
  ])("returns true for %s", (url) => {
    expect(isContentRequest(url)).toBe(true)
  })

  it.each([
    "/odata/v4/processor/Incidents",
    "/odata/v4/processor/Incidents(1)",
    "/odata/v4/processor/Incidents(1)/attachments",
    "/content/extra/segment",
    "/content/$value/extra",
    "",
    null,
    undefined,
  ])("returns false for %s", (url) => {
    expect(isContentRequest(url)).toBe(false)
  })

  it("strips query string before matching", () => {
    expect(isContentRequest("/Incidents(1)/content?sap-client=100")).toBe(true)
    expect(isContentRequest("/Incidents(1)/content/$value?foo=bar")).toBe(true)
  })

  it("strips fragment before matching", () => {
    expect(isContentRequest("/Incidents(1)/content#section")).toBe(true)
  })
})

describe("extractContentPrefix", () => {
  it("returns undefined for plain /content", () => {
    expect(
      extractContentPrefix("/Incidents(1)/attachments(ID=1)/content"),
    ).toBeUndefined()
  })

  it("returns undefined for /content/$value", () => {
    expect(
      extractContentPrefix("/Incidents(1)/attachments(ID=1)/content/$value"),
    ).toBeUndefined()
  })

  it("returns the prefix for /foo_content", () => {
    expect(extractContentPrefix("/Entity(1)/foo_content")).toBe("foo")
  })

  it("returns the prefix for /foo_content/$value", () => {
    expect(extractContentPrefix("/Entity(1)/foo_content/$value")).toBe("foo")
  })

  it("returns the prefix for a multi-word field like /my_field_content/$value", () => {
    expect(extractContentPrefix("/Entity(1)/my_field_content/$value")).toBe(
      "my_field",
    )
  })

  it("strips query string before extracting prefix", () => {
    expect(extractContentPrefix("/Entity(1)/foo_content?sap-client=100")).toBe(
      "foo",
    )
    expect(extractContentPrefix("/Entity(1)/foo_content/$value?foo=bar")).toBe(
      "foo",
    )
  })

  it("returns undefined for null/undefined", () => {
    expect(extractContentPrefix(null)).toBeUndefined()
    expect(extractContentPrefix(undefined)).toBeUndefined()
  })
})

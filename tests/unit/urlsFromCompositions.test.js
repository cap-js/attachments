const AttachmentsService = require("../../srv/attachments/basic")

// Minimal root entity definition: Books.cover (Composition of one Attachments)
// and Books.chapters.file (Composition of many Chapters, each with one file).
const attachmentsDef = { name: "my.Books.attachments" }
const chapterDef = {
  name: "my.Chapters",
  elements: { file: { _target: { name: "my.Chapters.attachments" } } },
}
const parentTarget = {
  name: "my.Books",
  elements: {
    cover: { _target: attachmentsDef },
    chapters: { _target: chapterDef },
  },
}

describe("urlsFromCompositions", () => {
  const svc = Object.create(AttachmentsService.prototype)
  const urlsFromCompositions = (active, compositions) =>
    svc.urlsFromCompositions(active, compositions, parentTarget)

  it("handles a Composition of one that holds an uploaded file", () => {
    const active = { cover: { ID: "a", url: "u1" } }
    expect(urlsFromCompositions(active, [["cover"]])).toEqual([
      { url: "u1", target: "my.Books.attachments" },
    ])
  })

  it("handles a Composition of one that is null", () => {
    expect(urlsFromCompositions({ cover: null }, [["cover"]])).toEqual([])
  })

  it("skips null children when a nested Composition of one has no file", () => {
    const active = {
      chapters: [
        { ID: "c1", file: null },
        { ID: "c2", file: { ID: "f", url: "u2" } },
      ],
    }
    expect(urlsFromCompositions(active, [["chapters", "file"]])).toEqual([
      { url: "u2", target: "my.Chapters.attachments" },
    ])
  })

  it("keeps handling a Composition of many (array)", () => {
    const active = { cover: [{ url: "u1" }, { url: null }, { url: "u3" }] }
    expect(urlsFromCompositions(active, [["cover"]])).toEqual([
      { url: "u1", target: "my.Books.attachments" },
      { url: "u3", target: "my.Books.attachments" },
    ])
  })
})

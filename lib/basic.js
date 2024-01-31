const cds = require('@sap/cds')
const { extname } = require('path')
const DEBUG = cds.debug('attachments')

module.exports = class AttachmentsService extends cds.Service {

  async put (Attachments, data, _content) {
    if (!Array.isArray(data)) {
      if (_content) data.content = _content
      data = [data]
    }
    DEBUG?.('Uploading attachments for', Attachments.name, data.map?.(d => d.filename))
    return Promise.all (data.map (d => {
      if (!d.mimeType) {
        let ext = extname(d.filename).toLowerCase().slice(1)
        d.mimeType = Ext2MimeTyes[ext] || 'application/octet-stream'
      }
      return UPSERT (d) .into (Attachments)
    }))
  }

  async get (Attachments, keys) {
    DEBUG?.('Downloading attachment for', Attachments.name, keys)
    const result = await SELECT.from (Attachments,keys) .columns ('content')
    return result.content
  }

}


const Ext2MimeTyes = {
  aac:  'audio/aac',
  abw:  'application/x-abiword',
  arc:  'application/octet-stream',
  avi:  'video/x-msvideo',
  azw:  'application/vnd.amazon.ebook',
  bin:  'application/octet-stream',
  png:  'image/png',
  gif:  'image/gif',
  bmp:  'image/bmp',
  bz:   'application/x-bzip',
  bz2:  'application/x-bzip2',
  csh:  'application/x-csh',
  css:  'text/css',
  csv:  'text/csv',
  doc:  'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odp:  'application/vnd.oasis.opendocument.presentation',
  ods:  'application/vnd.oasis.opendocument.spreadsheet',
  odt:  'application/vnd.oasis.opendocument.text',
  epub: 'application/epub+zip',
  gz:   'application/gzip',
  htm:  'text/html',
  html: 'text/html',
  ico:  'image/x-icon',
  ics:  'text/calendar',
  jar:  'application/java-archive',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  js:   'text/javascript',
  json: 'application/json',
  mid:  'audio/midi',
  midi: 'audio/midi',
  mjs:  'text/javascript',
  mp3:  'audio/mpeg',
  mp4:  'video/mp4',
  mpeg: 'video/mpeg',
  mpkg: 'application/vnd.apple.installer+xml',
  otf:  'font/otf',
  pdf:  'application/pdf',
  ppt:  'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  rar:  'application/x-rar-compressed',
  rtf:  'application/rtf',
  svg:  'image/svg+xml',
  tar:  'application/x-tar',
  tif:  'image/tiff',
  tiff: 'image/tiff',
  ttf:  'font/ttf',
  vsd:  'application/vnd.visio',
  wav:  'audio/wav',
  woff: 'font/woff',
  woff2: 'font/woff2',
  xhtml: 'application/xhtml+xml',
  xls:  'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xml:  'application/xml',
  zip:  'application/zip',
  txt:  'application/txt',
  lst:  'application/txt',
}
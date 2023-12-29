const cds = require('@sap/cds/lib')
const LOG = cds.log('attachments')
const DEBUG = LOG._debug ? LOG.debug : undefined

cds.on('loaded', UnfoldModel)
cds.once('served', ()=> Promise.all([
  UploadInitialContent(),
  PluginHandlers(),
]))


function UnfoldModel (csn) {
  const Attachments = csn.definitions['sap.common.Attachments']
  if (Attachments) Attachments._is_attachments = true; else return
  cds.linked(csn).forall('Composition', comp => {
    if(comp._target._is_attachments && comp.parent && comp.is2many && !comp.on) {
      let keys = Object.keys(comp.parent.keys)
      if (keys.length > 1) throw cds.error `Entities with attachments must have a single key element`
      // Fill in on condition
      delete comp.keys
      comp.on = [
        {"ref":[ comp.name, 'subject' ]}, '=',
        {"ref":[ '$self', keys[0] ]}
      ]
      // Add UI.Facets
      let Facets = comp.parent['@UI.Facets']
      if (Facets) Facets.push({
        $Type : 'UI.ReferenceFacet', Target: `${comp.name}/@UI.LineItem`,
        Label : '{i18n>Attachments}',
      })
    }
  })
}


async function UploadInitialContent() {
  const { isdir, local } = cds.utils, _content = isdir('db/content'); if (!_content) return
  const Attachments = await cds.connect.to('attachments')
  const { join } = cds.utils.path
  const { readFile } = cds.utils.promises
  const _init = a => readFile(join(_content, a.filename)).then(c => a.content = c)
  // REVISIT: This ^^^ is not streaming, is it?
  const attachments = await SELECT `ID, filename` .from `sap.common.Attachments` .where `content is null`
  if (!attachments.length) return
  LOG.info('Loading initial content from', local(_content))
  await Promise.all (attachments.map(_init))
  // Only upload attachments if they are not already uploaded
  const new_attachments = await Attachments.get_new_uploads(attachments)
  await Attachments.upload(new_attachments)
}


async function PluginHandlers () {
  const Attachments = cds.model.definitions['sap.common.Attachments']
  if (Attachments) Attachments._is_attachments = true; else return
	await cds.connect.to('attachments') // ensure to connect to the attachments service
	for (const srv of cds.services) {
		if (srv instanceof cds.ApplicationService) {
			Object.values(srv.entities) .forEach (entity => {
				let any=0; for (let e in entity.elements) {
					if (e === 'SiblingEntity') continue // REVISIT: Why do we have this?
					const element = entity.elements[e]
					if (element._target?._is_attachments) {
						DEBUG?.('serving attachments for:', `${entity.name}/${e}`)
						srv.prepend(() => {
							srv.on ("READ", `${entity.name}/${e}`, ReadAttachmentsHandler)
							srv.on ("READ", entity.name +'/'+ element.name, ReadAttachmentsHandler)
						})
						any++
					}
				}
				if (any) srv.prepend(() => {
					srv.on ("READ", entity, ReadHandler)
					srv.on ("SAVE", entity, SaveHandler)
				})
			})
		}
	}
}


async function ReadAttachmentsHandler (req, next) {

  // Add image streaming
  const image_requested = req._path?.endsWith('$value')
  if (image_requested) {
    const stream = await cds.services.attachments.download(req.params[0])
    return { value: stream }
  }

  // Add attachment streaming (i.e. for S3 bucket)
  const attachment_requested = req._path?.endsWith('content') && !req.entity.endsWith('.drafts')
  if (attachment_requested) {
    const stream = await cds.services.attachments.download(req.data.ID)
    return { value: stream }
  }

  else return next()
}


async function ReadHandler (req, next) {
  let results = await next()
  if (results) {
    // Add image urls
    // TODO: Generalize this by rewriting getElementsOfType() function according to simplified model
    const imageElements = [['customer', 'avatar']] //getElementsOfType(req, 'Image')
    for (const element of imageElements) {
      const [k, v] = element
      if (results?.[k]) {
        const ID = results[k].ID
        if (!results[k]?.[v]) results[k] = Object.assign(results[k], { [v]: {}, })
        const baseUrl = req?.req?.baseUrl || 'http://localhost:4004'
        const baseEntity = cds.model.definitions[req.entity].elements[k].target.split('.')[1]
        const url = `${baseUrl}/${baseEntity}(${ID})/${v}/$value`
        results[k][v].url = url
        results[k][v]['url@oresults.mediaReadLink'] = url
      }
    }
    return results
  }
}


const SaveHandler = async function (req, next) {
  // Copy attachments from draft to active
  const results = await next()
  const AttachmentsSrv = cds.services.attachments
  const { Attachments } = this.entities
  // REVISIT: This is loading the attachments into buffers -> needs streaming instead
  const attachments = await SELECT`ID, filename, content`.from(Attachments.drafts).where({ subject: req.data.ID })
  // REVISIT: Only upload attachments if they are not already uploaded -> Fiori UI/CDS should distinguish between draft and active attachments
  const new_attachments = await AttachmentsSrv.get_new_uploads(attachments)
  await Promise.all (new_attachments.map (a => AttachmentsSrv.upload(a)))
  return results
}

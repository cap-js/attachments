const cds = require('@sap/cds/lib')
const LOG = cds.log('attachments')
const DEBUG = LOG._debug ? LOG.debug : undefined

cds.on('loaded', UnfoldModel)
cds.once('served', ()=> Promise.all([
  UploadInitialContent(),
  PluginHandlers(),
]))


function UnfoldModel (csn) {
  if ('Attachments' in csn.definitions) cds.linked(csn).forall('Composition', comp => {
    if (comp._target['@_is_media_data'] && comp.parent && comp.is2many) {
      let Facets = comp.parent['@UI.Facets']; if (!Facets) return
      DEBUG?.('Adding @UI.Facet to:', comp.parent.name)
      Facets.push({
        $Type : 'UI.ReferenceFacet', Target: `${comp.name}/@UI.LineItem`,
        Label : '{i18n>Attachments}',
      })
    }
  })
}


async function UploadInitialContent() {
  let { isdir, local } = cds.utils, _content = isdir('db/content'); if (!_content) return
  let { join } = cds.utils.path, { readFile } = cds.utils.fs.promises
  let AttachmentsSrv = await cds.connect.to('attachments'), n=0
  for (let each of cds.model.each (d => d['@_is_media_data'] && d.keys && !d.query)) {
    if (!n++) DEBUG?.('Uploading initial content from:', local(_content), '...')
    let keys = Object.keys(each.keys)
    let attachments = await SELECT(...keys,'content').from(each).where({ content: { like: 'file:%' } })
    if (!attachments.length) continue
    await Promise.all (attachments.map (a => readFile (join(_content, a.filename ??= a.content.slice(5))).then(c => a.content = c)))
    await AttachmentsSrv.put(each,attachments)
  }
}


async function PluginHandlers () {
  if ('Attachements' in cds.model.definitions) ; else return
	await cds.connect.to('attachments') // ensure to connect to the attachments service
  const Images = cds.model.definitions['sap.common.Images']
  Images._is_images = true
  for (let srv of cds.services) {
		if (srv instanceof cds.ApplicationService) {
			Object.values(srv.entities) .forEach (entity => {
				let any=0; for (let e in entity.elements) {
					if (e === 'SiblingEntity') continue // REVISIT: Why do we have this?
					const element = entity.elements[e], target = element._target
					if (target?.['@_is_media_data']) {
						DEBUG?.('serving attachments for:', target.name)
            srv.prepend(() => {
              const handler = target._is_images ? ReadImage : ReadAttachment
              for (let each of [target, target.drafts]) if (each) srv.on ("READ", each, handler)
            })
            // srv.on ("NEW", entity, AddAttachmentHandler(element))
            srv.after ("SAVE", entity, DraftSaveHandler4(element))
						any++
					}
				}
				if (any) srv.prepend(() => srv.on ("READ", entity, ReadHandler))
			})
		}
	}
}


async function ReadImage (req, next) {
  if (!req._path?.endsWith('$value')) return next()
  let keys = { ID: req.params.at(-1) }
  let stream = await cds.services.attachments.get (req.target,keys)
  return { value: stream } // REVISIT: where does that { value: ... } come from? OData?
}

async function ReadAttachment (req, next) {
  if (!req._path?.endsWith('content')) return next()
  let Attachments = req.target, keys = req.params.at(-1)
  if (Attachments.isDraft) {
    // New attachements added in draft mode are stored in the database...
    let stream = await STREAM.from (Attachments,keys) .column ('content')
    if (stream) return { value: stream } // REVISIT: where does that { value: ... } come from? OData?
    else Attachments = Attachments.actives // if not found, read from active data subsequently...
  }
  let stream = await cds.services.attachments.get (Attachments,keys)
  return { value: stream } // REVISIT: where does that { value: ... } come from? OData?
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


/**
 * Returns a handler to copy updated attachments content from draft to active / object store
 */
const DraftSaveHandler4 = composition => {
  const AttachmentsSrv = cds.services.attachments
  const Attachments = composition._target
  const keys_and_content = _keys4(Attachments) .map (k => ({ref:[k]})) .concat ({ref:['content']})
  return async (_, req) => {
    // REVISIT: The below query loads the attachments into buffers -> needs streaming instead
    const attachments = await SELECT (keys_and_content) .from (Attachments.drafts) .where ([
      ...req.subject.ref[0].where.map(x => x.ref ? {ref:['up_',...x.ref]} : x),
      'and', {ref:['content']}, 'is not null' // NOTE: needs skip LargeBinary fix to Lean Draft
    ])
    if (attachments.length) await AttachmentsSrv.put (Attachments, attachments)
  }
}


const _keys4 = Attachments => {
  let { up_ } = Attachments.keys
  if (up_) return up_.keys.map(k => 'up__'+k.ref[0]).concat('filename')
  else return Object.keys(Attachments.keys)
}
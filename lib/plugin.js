const cds = require('@sap/cds/lib')
const LOG = cds.log('attachments')
const DEBUG = LOG._debug ? LOG.debug : undefined

cds.on('loaded', function UnfoldModel (csn) {
  if ('Attachments' in csn.definitions) ; else return
  cds.linked(csn).forall('Composition', comp => {
    if (comp._target['@_is_media_data'] && comp.parent && comp.is2many) {
      let Facets = comp.parent['@UI.Facets']; if (!Facets) return
      DEBUG?.('Adding @UI.Facet to:', comp.parent.name)
      Facets.push({
        $Type : 'UI.ReferenceFacet', Target: `${comp.name}/@UI.LineItem`,
        Label : '{i18n>Attachments}',
      })
    }
  })
})


cds.once('served', async function PluginHandlers () {

  if ('Attachments' in cds.model.definitions) ; else return
	const AttachmentsSrv = await cds.connect.to('attachments')

  // Tagging sap.common.Images and all derivates of it
  cds.model.definitions['sap.common.Images']._is_images = true

  // Searching all associations to attachments to add respective handlers
  for (let srv of cds.services) {
		if (srv instanceof cds.ApplicationService) {
			Object.values(srv.entities) .forEach (entity => {
				let any=0; for (let e in entity.elements) {
					if (e === 'SiblingEntity') continue // REVISIT: Why do we have this?
					const element = entity.elements[e], target = element._target
					if (target?.['@_is_media_data']) {
						DEBUG?.('serving attachments for:', target.name)
            const handler = target._is_images ? ReadImage : ReadAttachment
            for (let each of [target, target.drafts]) if (each) srv.after ("READ", each, handler)
            // srv.on ("NEW", entity, AddAttachmentHandler(element))
            srv.after ("SAVE", entity, DraftSaveHandler4(element))
						any++
					}
				}
        // Add handler to render image urls in objec pages
				if (any) srv.after ("READ", entity, AddImageUrl)
			})
		}
	}

  async function AddImageUrl (results, req) {
    if (results.length !== 1) return
    // Add image urls
    // TODO: Generalize this by rewriting getElementsOfType() function according to simplified model
    const imageElements = [['customer', 'avatar']]
    const [result] = results
    for (const element of imageElements) {
      const [k, v] = element
      if (result[k]) {
        const ID = result[k].ID
        if (!result[k][v]) result[k] = Object.assign(result[k], { [v]: {}, })
        const baseUrl = req?.req?.baseUrl || 'http://localhost:4004'
        const baseEntity = cds.model.definitions[req.entity].elements[k].target.split('.')[1]
        const url = `${baseUrl}/${baseEntity}(${ID})/${v}/$value`
        result[k][v].url = url
        result[k][v]['url@results.mediaReadLink'] = url
      }
    }
  }

  async function ReadImage ([attachment], req) {
    if (!req._path?.endsWith('$value')) return
    if (!attachment.content) {
      let keys = { ID: req.params.at(-1) }
      attachment.content = await AttachmentsSrv.get (req.target,keys)
    }
  }

  async function ReadAttachment ([attachment], req) {
    if (!req._path?.endsWith('content')) return
    if (!attachment.content && req.target.isDraft) { // if not found, read attachment from active data...
      let keys = req.params.at(-1)
      attachment.content = await AttachmentsSrv.get (req.target.actives,keys)
    }
  }

  /**
   * Returns a handler to copy updated attachments content from draft to active / object store
   */
  function DraftSaveHandler4 (composition) {
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

  function _keys4 (Attachments) {
    let { up_ } = Attachments.keys
    if (up_) return up_.keys.map(k => 'up__'+k.ref[0]).concat('filename')
    else return Object.keys(Attachments.keys)
  }
})

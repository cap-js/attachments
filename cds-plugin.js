const cds = require('@sap/cds')
const DEBUG = cds.debug('attachments')

cds.on('loaded', async (m) => {
  const Attachments = m.definitions['sap.common.Attachments']
  if (Attachments) Attachments._is_attachments = true; else return
  cds.linked(m).forall('Composition', comp => {
    if(comp._target._is_attachments && comp.parent && comp.is2many && !comp.on) {
      let keys = Object.keys(comp.parent.keys)
      if (keys.length > 1) throw cds.error `Objects with attachments must have a single key element`
      comp.on = [
        {"ref":[ comp.name, 'object' ]}, '=',
        {"ref":[ '$self', keys[0] ]}
      ]
      delete comp.keys
    }
  })
})


cds.on('served', async () => {
	let any = 0
	for (const srv of cds.services) {
		if (srv instanceof cds.ApplicationService) {
			Object.values(srv.entities) .forEach (entity => {
				let _any=0; for (let e in entity.elements) {
					if (e === 'SiblingEntity') continue // REVISIT: Why do we have this?
					const element = entity.elements[e]
					if (element._target?._is_attachments) {
						DEBUG?.('serving attachments for:', `${entity.name}/${e}`)
						srv.prepend(() => {
							srv.on ("READ", `${entity.name}/${e}`, ReadAttachmentsHandler)
							srv.on ("READ", entity.name +'/'+ element.name, ReadAttachmentsHandler)
						})
						_any++
					}
				}
				if (_any) srv.prepend(() => {
					srv.on ("READ", entity, ReadHandler)
					srv.on ("SAVE", entity, SaveHandler)
					any++
				})
			})
		}
	}
	if (any) await cds.connect.to('attachments') // ensure to connect to the attachments service
})


async function ReadAttachmentsHandler (req, next) {

  // Add image streaming
  const imageIsRequested = req._path?.endsWith('$value')
  if (imageIsRequested) {
    const stream = await cds.services.attachments.download(req.params[0])
    return { value: stream }
  }

  // Add attachment streaming (i.e. for S3 bucket)
  const attachmentIsRequested = req._path?.endsWith('content') && !req.entity.endsWith('.drafts')
  if (attachmentIsRequested) {
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
  const results = await next()

  const AttachmentsSrv = cds.services.attachments
  const { Attachments } = this.entities

  // Copy attachments from draft to active
  // REVISIT: This is loading the attachments into buffers -> needs streaming instead
  const attachments = await SELECT`ID, filename, content`.from(Attachments.drafts).where({ object: req.data.ID })
  await Promise.all (attachments.map (a => a.content && AttachmentsSrv.upload(a)))

  return results
}

const cds = require('@sap/cds')

// Make images available to app
cds.on('bootstrap', async app => {
  app.get('/media/', async (req, res) => {
    const { ObjectStoreService } = cds.services
    const file = req.query.file;
    if (file) {
      const stream = await ObjectStoreService.getObjectAsStream(file)
      res.setHeader('Content-Type', 'application/octet-stream')
      stream.pipe(res)
    }
    return res
  })
})

cds.on('served', async () => {
  // TODO: Replace this by UI feature later on
  //const { ObjectStoreService } = cds.services
  //await ObjectStoreService.uploadBulk()

  // Register on READ handler of annotated service
  registerHandler(readHandler)

  async function readHandler(req, next) {
    const data = await next()
    const origin = req.http.req.headers.origin
    const ref = getEntityRef() //req.target.projection.from.ref[0];

    if (data.length && ref) {
      data.map((d, i) => {
        if (d && d.customer && ref) {
          const file = `${ref}-${d.customer.ID}.png`
          Object.assign(d.customer, {
            avatar: `${origin}/media/?file=${file}`
          })
        }
      })
    }
    return data
  }
})

function registerHandler(readHandler) {
  Object.values(cds.services)
  .forEach(s => {
    Object.values(s.entities).forEach(e => {
      const elements = e.elements;
      Object.entries(elements).forEach(([k, v]) => {
        if (v['@Core.IsURL'] && !s.kind) {
          console.log(`> Registering on READ handler @${e.name}.${k}`)
          s.prepend(() => s.on('READ', readHandler))
        }
      })
    })
  })
}

function getEntityRef() {
  let ref = []
  Object.values(cds.entities).filter(e => e.compositions).forEach(c => {
    const elements = c.elements;
    Object.entries(elements).forEach(([k, v]) => {
      if (v['@Core.IsURL'] && !c.projection) {
        ref.push(`${c.name}`)
      }
    })
  })
  return ref[0]
}

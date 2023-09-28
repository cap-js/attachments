const cds = require('@sap/cds')

// Make images available to app under:
// <APP_URL>/media/filename
// TODO: Have this on the service where the attachment was annotated
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

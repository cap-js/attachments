const cds = require('@sap/cds')

cds.on('served', async () => {
    const { ObjectStoreService } = cds.services

    // Add data for testing purposes
    //await ObjectStoreService.uploadBulk()

    // TODO: Filter services for one that requires images
    Object.values(cds.services)
      .forEach(s => {
      s.prepend(() => s.on('READ', readHandler))
    })

    async function readHandler (req, next) {
      const data = await next();
      const attachments = await ObjectStoreService.listObjects();

      // TODO: Show avatars next to customer name in table
      if (data.length) {
        data.map((d, i) => Object.assign(d, {
          avatar: { imageUrl: attachments[i].imageUrl }
        }))
      }
      return data
    }

})

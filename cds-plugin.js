const cds = require('@sap/cds');

cds.on('served', () => {

    // TODO: Add as unit test
    // Check for 'Attachments' in sample
    // Object.values(cds.entities).filter(e => e.compositions)
    //     .forEach(c => {
    //         const elements = c.elements;
    //         Object.entries(elements).forEach(([k, v]) => {
    //                 if (v.target === 'Documents') {
    //                     console.log('')
    //                     console.log(`> Found Attachments on '${c.name}.${k}'`)
    //                 }
    //             })
    //     })

})

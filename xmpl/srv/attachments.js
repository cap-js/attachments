const fs = require('fs')
const path = require('path')

const SERVICE_PLANS = require('@cap-js/attachments/lib/services.json')

/**
 * Here we add initial data to simulate already uploaded images/attachments.
 */
module.exports = class ProcessorService extends cds.ApplicationService {
    async init() {

        const plan = cds.env.requires['@cap-js/attachments']?.['service-plan'] || 'db-service'
        const AttachmentsSrv = await cds.connect.to(SERVICE_PLANS[plan])

        console.log('\nAdding initial data...')

        const data_images = [{
            ID: '8fc8231b-f6d7-43d1-a7e1-725c8e988d18',
            filename: 'Daniel Watts.png',
            mimeType: 'image/png',
            content: fs.readFileSync(path.join(__dirname, 'content/avatars/Daniel Watts.png'))
        },
        {
            ID: 'feb04eac-f84f-4232-bd4f-80a178f24a17',
            filename: 'Stormy Weathers.png',
            mimeType: 'image/png',
            content: fs.readFileSync(path.join(__dirname, 'content/avatars/Stormy Weathers.png'))
        },
        {
            ID: '2b87f6ca-28a2-41d6-8c69-ccf16aa6389d',
            filename: 'Sunny Sunshine.png',
            mimeType: 'image/png',
            content: fs.readFileSync(path.join(__dirname, 'content/avatars/Sunny Sunshine.png'))
        }]
        // eslint-disable-next-line no-unused-vars
        const data_images_wo_contents = data_images.map(({ content, ...rest}) => rest)

        const data_customers = data_images.map(d => Object.assign(
            { ID: d.ID },
            { avatar_ID: d.ID }
        ))

        const data_attachments = [{
                ID: '548da458-fa8b-4c3b-a1d0-ba034d54600a',
                object: '3b23bb4b-4ac7-4a24-ac02-aa10cabd842c',
                createdAt: '2023-10-10T18:53:26.751Z',
                createdBy: 'alice',
                filename: 'INVERTER FAULT REPORT.pdf',
                mimeType: 'application/pdf',
                content: fs.readFileSync(path.join(__dirname, 'content/attachments/INVERTER FAULT REPORT.pdf'))
            },
            {
                ID: 'cc351101-0505-4e11-8f1b-67544ee156cc',
                object: '3b23bb4b-4ac7-4a24-ac02-aa10cabd842c',
                createdAt: '2023-10-11T19:52:26.751Z',
                createdBy: 'alice',
                filename: 'Inverter-error-logs.txt',
                mimeType: 'text/plain',
                content: fs.readFileSync(path.join(__dirname, 'content/attachments/Inverter-error-logs.txt')),
                note: 'Raw error logs'
            },
            {
                ID: 'cbd9ca9e-2c7d-4898-9fe5-4e7f46598209',
                object: '3a4ede72-244a-4f5f-8efa-b17e032d01ee',
                createdAt: '2023-10-09T18:50:20.751Z',
                createdBy: 'alice',
                filename: 'No_Current.xlsx',
                mimeType: 'application/vnd.ms-excel',
                content: fs.readFileSync(path.join(__dirname, 'content/attachments/No_current.xlsx'))
            },
            {
                ID: '016a6800-dc4f-4b96-8883-68ecd12a49c5',
                object: '3ccf474c-3881-44b7-99fb-59a2a4668418',
                createdAt: '2023-10-18T18:55:26.751Z',
                createdBy: 'alice',
                filename: 'strange-noise.csv',
                mimeType: 'text/csv',
                content: fs.readFileSync(path.join(__dirname, 'content/attachments/strange-noise.csv'))
            },
            {
                ID: '4474092e-1863-4f03-8821-7cdae5f44cdf',
                object: '3583f982-d7df-4aad-ab26-301d4a157cd7',
                createdAt: '2023-10-01T15:53:26.751Z',
                createdBy: 'alice',
                filename: 'Broken Solar Panel.jpg',
                mimeType: 'image/jpeg',
                content: fs.readFileSync(path.join(__dirname, 'content/attachments/Broken Solar Panel.jpg')),
                note: 'See the broken solar panel'
            }]
            // eslint-disable-next-line no-unused-vars
            const data_attachments_wo_contents = data_attachments.map(({ content, ...rest}) => rest)

        // This adds the avatar ID to the Customers table
        await UPSERT.into('ProcessorService.Customers').entries(data_customers)

        switch (plan) {
            case 'db-service':
                // If not service plan is provided, the contents are stored with their metadata in the database
                await INSERT.into('sap.common.Images').entries(data_images)
                await INSERT.into('sap.common.Attachments').entries(data_attachments)
                break
            case 's3-standard':
                await INSERT.into('sap.common.Images').entries(data_images_wo_contents)
                await INSERT.into('sap.common.Attachments').entries(data_attachments_wo_contents)

                // For AWS S3, the contents are stored in the bucket
                data_images.forEach(async (d) => {
                    await AttachmentsSrv.onPUT(d.content, d.filename.split('.').pop(), d.ID)
                })
                data_attachments.forEach(async (d) => {
                    await AttachmentsSrv.onPUT(d.content, d.filename.split('.').pop(), d.ID)
                })

                break
        }

        return super.init()

    }
}
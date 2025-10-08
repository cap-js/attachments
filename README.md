[![REUSE status](https://api.reuse.software/badge/github.com/cap-js/attachments)](https://api.reuse.software/info/github.com/cap-js/attachments)

# Attachments Plugin

The `@cap-js/attachments` package is a [CDS plugin](https://cap.cloud.sap/docs/node.js/cds-plugins#cds-plugin-packages) that provides out-of-the box asset storage and handling by using an [*aspect*](https://cap.cloud.sap/docs/cds/cdl#aspects) called `Attachments`. It also provides a CAP-level, easy-to-use integration of the [SAP Object Store](https://help.sap.com/docs/object-store/object-store-service-on-sap-btp/what-is-object-store).

### Table of Contents

<!-- TOC -->

* [Quick Start](#quick-start)
* [Local Walk-Through](#local-walk-through)
* [Usage](#usage)
  * [Package Setup](#package-setup)
  * [Changes in the CDS Models](#changes-in-the-cds-models)
  * [Storage Targets](#storage-targets)
  * [Malware Scanner](#malware-scanner)
  * [Outbox](#outbox) ?
  * [Restore Endpoint](#restore-endpoint) ?
    * [Motivation](#motivation)
    * [HTTP Endpoint](#http-endpoint)
    * [Security](#security)
  * [Visibility Control](#visibility-control-for-attachments-ui-facet-generation)
  * [Non-Draft Uploading](non-draft-upload)
* [Releases](#releases) ?
* [Minimum UI5 and CAP NodeJS Version](#minimum-ui5-and-cap-nodejs-version)
* [Architecture Overview](#architecture-overview)
  * [Design](#design) ?
  * [Multitenancy](#multitenancy)
  * [Object Stores](#object-stores) ?
  * [Model Texts](#model-texts) ?
* [Support, Feedback, Contributing ](#support-feedback-and-contributing)
* [Code of Conduct](#code-of-conduct)
* [Licensing](#licensing)

## Quick Start

For a quick setup with in-memory storage: 

- The plugin is self-configuring as described in [Package Setup](#package-setup). To enable attachments, simply add the plugin package to your project:  
```sh
 npm add @cap-js/attachments
 ```
- To use Attachments, simply extend a CDS model by adding an element that refers to the pre-defined Attachments type (see [Changes in the CDS Models](changes-in-the-cds-models) for more details): 
```cds
using { Attachments } from '@cap-js/attachments';

entity Incidents {  
  // ...  
  attachments: Composition of many Attachments;  
}
```

In this guide, we use the [Incidents Management reference sample app](https://github.com/cap-js/incidents-app) as the base application to provide a demonstration how to use this plugin. 

For object store integration, see [Object Stores](#object-stores).


## Local Walk-Through
With the steps above, we have successfully set up asset handling for our reference application. Let's see that in action by extending the Incidents Entity in the schema.cds file. We can try out the scenarios where the attachments contents are stored locally in the database.

1. **Start the server**:

  - *Default* scenario (In memory database):
      ```sh
      cds watch
      ```

2. **Navigate to the object page** of the incident `Solar panel broken`:

    Go to [Object page for incident **Solar panel broken**](http://localhost:4004/incidents/app/#/Incidents(ID=3583f982-d7df-4aad-ab26-301d4a157cd7,IsActiveEntity=true))

3. The `Attachments` type has generated an out-of-the-box Attachments table (see 1) at the bottom of the Object page:
<img width="1300" alt="Attachments Table" style="border-radius:0.5rem;" src="etc/facet.png">

4. **Upload a file** by going into Edit mode and either by clicking the **Upload** button above the Attachments table or by draging and droping the file into the Attachments table direcly. Then click the **Save** button to have that file stored in the dedicated resource (database, S3 bucket, etc.). The PDF file from [_xmpl/db/content/Solar Panel Report.pdf_](./xmpl/db/content/Solar%20Panel%20Report.pdf) can be used as an example:
<img width="1300" alt="Upload an attachment" style="border-radius:0.5rem;" src="etc/upload.gif">

6. **Delete a file** by going into Edit mode, selecting the file, and pressing the **Delete** button above the Attachments table. Clicking the **Save** button will then delete that file from the resource (database, S3 bucket, etc.).
<img width="1300" alt="Delete an attachment" style="border-radius:0.5rem;" src="etc/delete.gif">

## Usage

### Package Setup

The attachments plugin needs to be referenced in the package.json of the consuming CAP NodeJS application: 

```cds
"devDependencies": { 
    "@cap-js/attachments": "<latest-version>", 
    //... 
}
```

This is done automatically by running `npm add @cap-js/attachments`. With this, the aspect Attachments can be used in the application's CDS model. 


### Changes in the CDS Models

To use the aspect `Attachments` on an existing entity, the corresponding entity needs to either include attachments as an element in the model definition or be extended in a CDS file in the `srv` module. In the quick start, the former was done, adding an element to the model definition: 
```cds
using { Attachments } from '@cap-js/attachments';  

entity Incidents {  
  // ...  
  attachments: Composition of many Attachments;  
} 
```
 
The entity Incidents can also be extended in the `srv` module, as seen in the following example:  
```cds
using { Attachments } from '@cap-js/attachments'; 

extend my.Incidents with { 
  attachments: Composition of many Attachments; 
} 
  
service ProcessorService { 
  entity Incidents as projection on my.Incidents 
}
```

Both methods directly add the respective UI Facet. Take note that in order to use the plugin with Fiori elements UI, be sure that [`draft` is enabled](https://cap.cloud.sap/docs/advanced/fiori#enabling-draft-with-odata-draft-enabled) for the entity using `@odata.draft.enabled`. 


### Storage Targets

By default, the plugin operates without a dedicated storage target, storing attachments directly in the underlying database. 

Other available storage targets: 
- AWS 
- Local mock file system (only for testing scenarios) 

When using a dedicated storage target, the attachment is not stored in the underlying database; instead, it is saved on the specified storage target and only a reference to the file is kept in the database, as defined in the CDS model. 

For using SAP Object Store, you must already have an SAP Object Store service instance with a storage target which you can access. To connect it, follow this setup.

1. Log in to Cloud Foundry:

    ```sh
    cf login -a <CF-API> -o <ORG-NAME> -s <SPACE-NAME> --sso
    ```

2.  To bind to the service, continue with the steps below.

    In the project directory, you can generate a new file _.cdsrc-private.json by running:

    ```sh
    cds bind objectstore -2 <INSTANCE>:<SERVICE-KEY> --kind s3
    ```

### Malware Scanner

The malware scanner is used in the `AttachmentService` to scan attachments. 

For using [SAP Malware Scanning Service](https://discovery-center.cloud.sap/serviceCatalog/malware-scanning-service), you must already have a service instance which you can access and run the following command:
    ```sh
    cds bind malware-scanner -2 <INSTANCE>:<SERVICE-KEY>
    ```

By default, malware scanning is enabled for all profiles unless no storage provider has been specified. You can configure malware scanning by setting:
```json
"attachments": {
    "scan": true
}
```

If there is no malware scanner available, the attachments are automatically marked as Clean. 

Scan status codes: 
- Clean: Only attachments with the status Clean are accessible. 
- Scanning: Immediately after upload, the attachment is marked as Scanning. Depending on processing speed, it may already appear as Clean when the page is reloaded. 
- Unscanned: Attachment is still unscanned. 
- Failed: Scanning failed. 
- Infected: The attachment is infected. 

> [!Note]
> The plugin currently supports file uploads [up to 400 MB in size per attachment](https://help.sap.com/docs/malware-scanning-servce/sap-malware-scanning-service/what-is-sap-malware-scanning-service). 


### Outbox 

In this plugin the [persistent outbox](https://cap.cloud.sap/docs/java/outbox#persistent) is used to mark attachments as deleted. When using this plugin, the persistent outbox is enabled by default. In the capire documentation of the [persistent outbox](https://cap.cloud.sap/docs/java/outbox#persistent) it is described how to overwrite the default outbox configuration. 

If the default is used, nothing must be done. 


### Restore Endpoint

The attachment service has an event `RESTORE_ATTACHMENTS`.
This event can be called with a timestamp to restore externally stored attachments.

By setting the `@UI.Hidden` property to `true`, developers can hide the plugin from the UI achieving visibility.
This feature is particularly useful in scenarios where the visibility of the plugin needs to be dynamically controlled based on certain conditions.

### Visibility Control for Attachments UI Facet Generation

By setting the `@attachments.disable_facet` property to `true`, developers can hide the visibility of the plugin in the UI. This feature is particularly useful in scenarios where the visibility of the plugin needs to be dynamically controlled based on certain conditions.

#### Example Usage

```cds
entity Incidents {
  // ...
  @UI.Hidden
  attachments: Composition of many Attachments;
}
```
In this example, the `@UI.Hidden` is set to `true`, which means the plugin will be hidden by default. You can also use dynamic expressions which are then added to the facet.


```cds
entity Incidents {
  // ...
  status : Integer enum {
    submitted =  1;
    fulfilled =  2;
    shipped   =  3;
    canceled  = -1;
  };
  @UI.Hidden : (status = #canceled ? true : false)
  attachments: Composition of many Attachments;
}
```

### Non-Draft Upload

For scenarios where the entity is not draft-enabled, see the sample [`tests/non-draft-request.http`](./tests/non-draft-request.http) to perform `.http` requests for metadata creation and content upload.

The typical sequence includes:

1. **POST** to create attachment metadata  
2. **PUT** to upload file content using the ID returned

> Make sure to replace `{{host}}`, `{{auth}}`, and IDs accordingly.

## Releases

- The plugin is released to [WHERE?].
- See the [changelog](./CHANGELOG.md) for the latest changes.

## Minimum UI5 and CAP NodeJS Version

| Component | Minimum Version |
|-----------|-----------------|
| CAP Node  | 3.10.3          |
| UI5       | 1.136.0         |

To be able to use the Fiori `uploadTable` feature, you must ensure 1.121.0/ 1.122.0/ ^1.125.0 SAPUI5 version is updated in the application's `index.html`


## Architecture Overview
### Design
- [Design Details](./doc/Design.md)
- [Process of Creating, Reading and Deleting an Attachment](./doc/Processes.md)

### Multitenancy

The plugin supports multitenancy scenarios, allowing both shared and tenant-specific object store instances.

- When using SAP HANA as the storage target, multitenancy support depends on the consuming application. In most cases, multitenancy is achieved by using a dedicated schema for each tenant, providing strong data isolation at the database level.
- When using an [object store](storage-targets/cds-feature-attachments-oss) as the storage target, true multitenancy is not yet implemented (as of version 1.2.1). In this case, all blobs are stored in a single bucket, and tenant data is not separated.

> [!Note]
> Starting from version 2.1.0, **separate mode** for object store instances is the default setting for multitenancy.  
> As of version 2.2.0, both the `standard` and `S3-standard` plans of the SAP Object Store offering are supported.  
> **Important:** The `S3-standard` plan is no longer available for new subscriptions. For new object store instances, use the `standard` plan.

For multitenant applications, `@cap-js/attachments` must be included in the dependencies of both the application-level and mtx/sidecar package.json files.

### Shared Object Store Instance

To configure a shared object store instance, modify both the package.json files as follows:

```json
"cds": {
    "requires": {
        "attachments": {
            "objectStore": {
                "kind": "shared"
            }
        }
    }
}
```
To ensure tenant identification when using a shared object store instance, the plugin prefixes attachment URLs with the tenant ID. Be sure the shared object store instance is bound to the `mtx` application module before deployment.

### Object Stores

A valid Object Store service binding is required, typically one provisioned through SAP BTP. See [Local development](#local-development) and [Deployment to Cloud Foundry](#deployment-to-cloud-foundry) on how to use this object store service binding.

#### Local development

For local development, bind to an Object Store service using the `cds bind` command as described in the [CAP documentation for hybrid testing](https://cap.cloud.sap/docs/advanced/hybrid-testing#services-on-cloud-foundry):

```bash
cds bind <service-instance-name>
```

This will create an entry in the `.cdsrc-private.json` file with the service binding configuration. Then start the application with:

```bash
cds watch --profile hybrid
```

#### Deployment to Cloud Foundry
The corresponding entry in the [mta-file](https://cap.cloud.sap/docs/guides/deployment/to-cf#add-mta-yaml) possibly looks like:

```
_schema-version: '0.1'
ID: consuming-app
version: 1.0.0
description: "App consuming the attachments plugin with an object store"
parameters:
  ...
modules:
  - name: consuming-app-srv
# ------------------------------------------------------------
    type: nodejs
    path: srv
    parameters:
      ...
    properties:
      ...
    build-parameters:
      ...
    requires:
      - name: consuming-app-hdi-container
      - name: consuming-app-uaa
      - name: cf-logging
      - name: **object-store-service**
...
resources:
  ...
  - name: **object-store-service**
    type: org.cloudfoundry.managed-service
    parameters:
      service: objectstore
      service-plan: standard
```


##### Tests

The unit tests in this module do not need a binding to the respective object stores, run them with `npm install`. To achieve a clean install, the comman `rm -rf node_modules` should be used before installation.

The integration tests need a binding to a real object store. Run them with `npm run test`.
To set the binding, provide the following environment variables:
- AWS_S3_BUCKET
- AWS_S3_REGION
- AWS_S3_ACCESS_KEY_ID
- AWS_S3_SECRET_ACCESS_KEY

##### Supported Storage Backends

- **AWS S3**

### Model Texts

In the model, several fields are annotated with the `@title` annotation. Default texts are provided in [35 languages](https://github.com/cap-java/cds-feature-attachments/tree/main/cds-feature-attachments/src/main/resources/cds/com.sap.cds/cds-feature-attachments/_i18n). If these defaults are not sufficient for an application, they can be overwritten by applications with custom texts or translations.

The following table gives an overview of the fields and the i18n codes:

| Field Name | i18n Code             |
|------------|-----------------------|
| `content`  | `attachment_content`  |
| `mimeType` | `attachment_mimeType` |
| `fileName` | `attachment_fileName` |
| `status`   | `attachment_status`   |
| `note`     | `attachment_note`     |

In addition to the field names, header information (`@UI.HeaderInfo`) are also annotated:

| Header Info      | i18n Code     |  
|------------------|---------------|
| `TypeName`       | `attachment`  |
| `TypeNamePlural` | `attachments` |


## Monitoring & Logging

To configure logging for the attachments plugin, add the following line to the `/srv/src/main/resources/application.yaml` of the consuming application:
```
logging:
  level:
    ...
    '[com.sap.cds.feature.attachments]': DEBUG
...
```

## Support, Feedback, and Contributing 

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/cap-js/attachments/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).

## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](CODE_OF_CONDUCT.md) at all times.

## Licensing

Copyright 2024 SAP SE or an SAP affiliate company and contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/cap-js/attachmentstea).

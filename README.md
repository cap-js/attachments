[![REUSE status](https://api.reuse.software/badge/github.com/cap-js/attachments)](https://api.reuse.software/info/github.com/cap-js/attachments)

# Attachments Plugin

The `@cap-js/attachments` package is a [CDS plugin](https://cap.cloud.sap/docs/node.js/cds-plugins#cds-plugin-packages) that provides out-of-the box asset storage and handling by using an [*aspect*](https://cap.cloud.sap/docs/cds/cdl#aspects) called `Attachments`. It also provides a CAP-level, easy-to-use integration of the [SAP Object Store](https://help.sap.com/docs/object-store/object-store-service-on-sap-btp/what-is-object-store).

### Table of Contents

<!-- TOC -->

* [Usage](#usage)
  * [Quick Start](#quick-start)
  * [Local Walk-Through](#local-walk-through)
  * [Changes in the CDS Models](#changes-in-the-cds-models)
  * [Storage Targets](#storage-targets)
  * [Malware Scanner](#malware-scanner)
  * [Visibility Control](#visibility-control-for-attachments-ui-facet-generation)
  * [Non-Draft Uploading](#non-draft-upload)
* [Releases](#releases)
* [Minimum UI5 and CAP NodeJS Version](#minimum-ui5-and-cap-nodejs-version)
* [Architecture Overview](#architecture-overview)
  * [Multitenancy](#multitenancy)
  * [Object Stores](#object-stores)
  * [Model Texts](#model-texts)
* [Monitoring & Logging](#monitoring--logging)
* [Support, Feedback, Contributing ](#support-feedback-and-contributing)
* [Code of Conduct](#code-of-conduct)
* [Licensing](#licensing)

## Usage

### Quick Start

For a quick local development setup with in-memory storage:

- The plugin is self-configuring as described, see the following details section. To enable attachments, simply add the plugin package to your project:  
  ```sh
  npm add @cap-js/attachments
  ```

  <details>
    The attachments plugin needs to be referenced in the package.json of the consuming CAP NodeJS application: 

    ```cds
    "devDependencies": { 
      "@cap-js/attachments": "<latest-version>", 
      // (...)
    }
    ```

    In addition, different profiles can be found in `package.json` as well, such as: 

    ```json
    "cds": {  
      "requires": {  
        // (...)
        "[hybrid]": {  
          "attachments": {  
            "kind": "standard"  
            // (...)
          }  
        }  
      }  
    }  
    ```
  </details>

- To use Attachments, extend a CDS model by adding an element that refers to the pre-defined Attachments type (see [Changes in the CDS Models](#changes-in-the-cds-models) for more details): 

  ```cds
  using { Attachments } from '@cap-js/attachments';

  entity Incidents {  
      // (...)
      attachments: Composition of many Attachments;  
  }
  ```

In this guide, we use the [Incidents Management reference sample app](https://github.com/cap-js/incidents-app) as the base application to provide a demonstration how to use this plugin. A miniature version of this app can be found within the [tests](./tests/incidents-app) directory for local testing.

For productive use, a valid object store binding is required, see [Object Stores](#object-stores) and [Storage Targets](#storage-targets).

### Local Walk-Through

With the steps above, we have successfully set up asset handling for our reference application. To test the application locally, use the following steps. 

> [!NOTE]
> For local testing, the attachment objects are stored in a [local database](https://cap.cloud.sap/docs/guides/databases-sqlite).

1. **Start the server**:

- *Default* scenario (In memory database):
  ```sh
  cds watch
  ```

2. **Navigate to the object page** of the incident `Solar panel broken`:
Go to object page for incident **Solar panel broken**

3. The `Attachments` type has generated an out-of-the-box Attachments table (see 1) at the bottom of the Object page:
  <img width="1300" alt="Attachments Table" style="border-radius:0.5rem;" src="etc/facet.png">

4. **Upload a file** by going into Edit mode and either using the **Upload** button on the Attachments table or by drag/drop. Then click the **Save** button to have that file stored that file in the dedicated resource (database, S3 bucket, etc.). We demonstrate this by uploading the PDF file from [_tests/integration/content/sample.pdf_](./tests/integration/content/sample.pdf):
  <img width="1300" alt="Upload an attachment" style="border-radius:0.5rem;" src="etc/upload.gif">

5. **Delete a file** by going into Edit mode, selecting the file, and pressing the **Delete** button above the Attachments table. Clicking the **Save** button will then delete that file from the resource (database, S3 bucket, etc.).
  <img width="1300" alt="Delete an attachment" style="border-radius:0.5rem;" src="etc/delete.gif">

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

Both methods directly add the respective UI Facet. To use the plugin with an SAP Fiori elements UI, be sure that [`draft` is enabled](https://cap.cloud.sap/docs/advanced/fiori#enabling-draft-with-odata-draft-enabled) for the entity using `@odata.draft.enabled`. For example:

```cds
annotate service.Incidents with @odata.draft.enabled;
```

### Storage Targets

When testing locally, the plugin operates without a dedicated storage target, storing attachments directly in the underlying database. In a hybrid setup, a dedicated storage target is preferred. You can bind it by using the `cds bind` command as described in the [CAP documentation for hybrid testing].(https://cap.cloud.sap/docs/advanced/hybrid-testing#services-on-cloud-foundry).

Meanwhile, with a dedicated storage target the attachment is not stored in the underlying database; instead, it is saved on the specified storage target and only a reference to the file including metadata is kept in the database, as defined in the CDS model. 

For using an Object Store in BTP, you must already have an SAP Object Store service instance on the appropriate landscape created. To bind it in a hybrid setup, follow this setup:

1. Log in to Cloud Foundry:

  ```sh
  cf login -a <CF-API> -o <ORG-NAME> -s <SPACE-NAME> --sso

2.  To bind to the service, generate a new file _.cdsrc-private.json in the project directory by running:

  ```sh
  cds bind <HybridObjectStoreName> --to <RemoteObjectStoreName>

Where `HybridObjectStoreName` can be any name given by the user here and `RemoteObjectStoreName` is the name of your object store instance in SAP BTP.

3.  To run the application in hybrid mode, run the command:

```bash
cds watch --profile hybrid
```

See [Object Stores](#object-stores) for further information on SAP Object Store.

### Malware Scanner

The BTP malware scanning service is used in the `AttachmentService` to scan attachments for vulnerabilities.

For using [SAP Malware Scanning Service](https://discovery-center.cloud.sap/serviceCatalog/malware-scanning-service), you must already have a service instance which you can access. To bind it, run the following command:

```sh
cds bind <HybridMalwareScannerName> --to <RemoteMalwareScannerName>
```

By default, malware scanning is enabled for all profiles if a storage provider has been specified. You can configure malware scanning by setting:

```json
{  
  "cds": {  
     // (...)  
     "attachments": {  
       "scan": true  
     }  
  }  
} 
```

If there is no malware scanner available and the scanner is not disabled, then the upload will fail. 

Scan status codes: 
- `Unscanned`: Attachment is still unscanned. 
- `Scanning`: Immediately after upload, the attachment is marked as Scanning. Depending on processing speed, it may already appear as Clean when the page is reloaded. 
- `Clean`: Only attachments with the status Clean are accessible. 
- `Infected`: The attachment is infected. 
- `Failed`: Scanning failed. 

> [!Note]
> The plugin currently supports file uploads up to 400 MB in size per attachment as this is a limitation of the [malware scanning service](https://help.sap.com/docs/malware-scanning-servce/sap-malware-scanning-service/what-is-sap-malware-scanning-service). Please note: this limitation remains even with the malware scanner disabled. 
> The malware scanner supports mTLS authentication which requires an annual renewal of the certificate. Previously, basic authentication was used which has now been deprecated.


### Visibility Control for Attachments UI Facet Generation

By setting the `@UI.Hidden` property to `true`, developers can hide the visibility of the plugin in the UI. This feature is particularly useful in scenarios where the visibility of the plugin needs to be dynamically controlled based on certain conditions.

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

For scenarios where the entity is not draft-enabled, for example [`tests/non-draft-request.http`](./tests/non-draft-request.http), separate HTTP requests for metadata creation and asset uploading need to be performed manually. 

The typical sequence includes:

1. **POST** -> create attachment metadata, returns ID  
2. **PUT** -> upload file content using the ID

## Releases

- The plugin is released to [NPM Registry](https://www.npmjs.com/package/@cap-js/attachments).
- See the [changelog](./CHANGELOG.md) or [GitHub Releases](https://github.com/cap-js/attachments/releases) for the latest changes.

## Minimum UI5 and CAP NodeJS Version

| Component | Minimum Version |
|-----------|-----------------|
| CAP Node  | 8.0.0           |
| UI5       | 1.136.0         |

## Architecture Overview
### Multitenancy

The plugin supports multitenancy scenarios, allowing both shared and tenant-specific object store instances.

> [!Note]
> Starting from version 2.1.0, **separate mode** for object store instances is the default setting for multitenancy.  

For multitenant applications, `@cap-js/attachments` must be included in the dependencies of both the application-level and _mtx/sidecar/package.json_ files.

#### Shared Object Store Instance

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

A valid object store service binding is required, typically one provisioned through SAP BTP. See [Storage Targets](#storage-targets) and [Deployment to Cloud Foundry](#deployment-to-cloud-foundry) on how to use this object store service binding.

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

The unit tests in this module do not need a binding to the respective object stores, run them with `npm install`. To achieve a clean install, the command `rm -rf node_modules` should be used before installation.

The integration tests need a binding to a real object store. Run them with `npm run test`.
To set the binding, please see the section [Storage Targets](#storage-targets).

##### Supported Storage Provider

- **Standard** (`kind: "standard"`) | Depending on the bound object store credentials, uses AWS S3, Azure Blob Storage or GCP Cloud Storage. You can manually specify the implementation by adjusting the type to:
    - **AWS S3** (`kind: "s3"`)
    - **Azure Blob Storage** (`kind: "azure"`)
    - **GCP Cloud Storage** (`kind: "gcp"`)

### Model Texts

In the model, several fields are annotated with the `@title` annotation. Default texts are provided in [2 languages](./_i18n). If these defaults are not sufficient for an application, they can be overwritten by applications with custom texts or translations.

The following table gives an overview of the fields and the i18n codes:

| Field Name | i18n Code    |
|------------|--------------|
| `mimeType` | `MediaType`  |
| `fileName` | `FileName`   |
| `status`   | `ScanStatus` |
| `note`     | `note`       |

In addition to the field names, header information (`@UI.HeaderInfo`) are also annotated:

| Header Info      | i18n Code     |  
|------------------|---------------|
| `TypeName`       | `Attachment`  |
| `TypeNamePlural` | `Attachments` |


## Monitoring & Logging

To configure logging for the attachments plugin, add the following configuration to the `package.json` of the consuming application:

```json
{
  "cds": {
    "log": {
      "levels": {
         // (...)
         "attachments": "debug"
      }
    }
  }
}
...
```

## Support, Feedback, and Contributing 

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/cap-js/attachments/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, the **local development setup**, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).

## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](CODE_OF_CONDUCT.md) at all times.

## Licensing

Copyright 2024 SAP SE or an SAP affiliate company and contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/cap-js/attachmentstea).

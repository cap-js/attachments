# Attachments Plugin for SAP Cloud Application Programming Model (CAP)

[![REUSE status](https://api.reuse.software/badge/github.com/cap-js/change-tracking)](https://api.reuse.software/info/github.com/cap-js/attachments)

The `@cap-js/attachments` package is a [CDS plugin](https://cap.cloud.sap/docs/node.js/cds-plugins#cds-plugin-packages) providing out-of-the box asset storage and handling by using a predefined *type* `Image` or *entity* `Attachments`. It also provides a CAP-level, easy to use integration of the Document Service/Object Store.

1. [Install the plugin: `npm add @cap-js/attachments`](#setup)
2. [Add `Image`, `Document`, or `Attachments` types to your CDS models](#annotations)
3. [Et voilà:](#attachments-view)

<!--img width="1300" alt="attachments-view" src="_assets/attachments-view.png"-->

### Table of Contents

- [Attachments Plugin for SAP Cloud Application Programming Model (CAP)](#attachments-plugin-for-sap-cloud-application-programming-model-cap)
    - [Table of Contents](#table-of-contents)
  - [Preliminaries](#preliminaries)
  - [Setup](#setup)
  - [Annotations](#annotations)
  - [Test-drive locally](#test-drive-locally)
  - [Contributing](#contributing)
  - [Code of Conduct](#code-of-conduct)
  - [Licensing](#licensing)



## Preliminaries

In this guide, we use the [Incidents Management reference sample app](https://github.com/cap-js/incidents-app) as the base to add attachments to. Clone the repository and apply the step-by-step instructions:

```sh
git clone https://github.com/cap-js/incidents-app
cd incidents-app
npm i
```

<!--**Alternatively**, you can clone the incidents app including the prepared enhancements for change-tracking:

```sh
git clone https://github.com/cap-js/calesi --recursive
cd calesi
npm i
```

```sh
cds w samples/attachments
```
-->


## Setup

To enable automatic asset handling, simply add this self-configuring plugin package to your project:

```sh
npm add @cap-js/attachments
```



## Annotations

All we need to do is to denote the respective asset elements with *type* `Image` or define a composition of *entity* `Attachments`. Following the [best practice of separation of concerns](https://cap.cloud.sap/docs/guides/domain-modeling#separation-of-concerns), we do so in a separate file _srv/attachments.cds_:

```cds
using { sap.capire.incidents } from './processor-service';
using { Image, sap.attachments as my } from '@cap-js/attachments';


// How to use type 'Image'
extend incidents.Customers with {
  avatar : Image;
};
annotate ProcessorService.Incidents with @(UI.HeaderInfo: {
  TypeImageUrl: customer.avatar.url
});


// How to use entity 'Attachments'
extend incidents.Incidents with {
  attachments : Composition of many my.Attachments
                on attachments.object = $self.ID;
};
```

...


## Test-drive locally

With the steps above, we have successfully set up asset handling for our reference application. Let's see that in action.

1. **Start the server**:
  ```sh
  cds watch
  ```
2. **Navigate to an incident's object page**, for example:

    Go to [Object page for incident **Inverter not functional**](http://localhost:4004/incidents/#/Incidents(ID=3b23bb4b-4ac7-4a24-ac02-aa10cabd842c,IsActiveEntity=true))

3. The `Image` annotation enabled us to show the customer's avatar in the header next to their name (see 1), while the `Attachments` annotation has generated an out-of-the-box Attachments table (see 2) at the bottom of the Object page:

    ![Customers with Image](./_assets/attachments-sample.png)


## Contributing

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/cap-js/change-tracking/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](CONTRIBUTING.md).


## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](CODE_OF_CONDUCT.md) at all times.


## Licensing

Copyright 2023 SAP SE or an SAP affiliate company and contributors. Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/cap-js/change-tracking).

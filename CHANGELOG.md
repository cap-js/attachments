# Change Log

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](http://semver.org/).
The format is based on [Keep a Changelog](http://keepachangelog.com/).

## Version 3.3.1

### Fixed

- Support for multiple run profiles

## Version 3.3.0

### Added

- Added [`standard`](./README.md#supported-storage-provider) kind and set it as the default so that the configuration needs no adjustment when switching hyper-scalers.
- Added support for uploading and updating attachments via `srv.run(INSERT.into(Attachments).entries())` or `srv.run(UPDATE.entity(Attachments).set())`

### Fixed

- Fixed an issue that in multi-tenancy scenarios with separate object stores duplicate object stores per tenant were created when updating the tenant binding via the SaaS dependency service.
- Fixed a race-condition where tenant isolation in separate object store mode could be broken.
- Fixed a case where attachments were not correctly deleted.
- Fixed a server crash when using the `AttachmentsSrv.put` API to upload an attachment.
- Fixed a server crash when no object store would be bound to the application on BTP.
- Fixed a server crash when the filename would not be given when creating new attachment metadata.
- Fixed an issue where attachment handlers would be missing when all Attachments entity were behind feature toggles.
- Fixed an issue where with storage kind `db` attachments could not be uploaded as drafts.
- Fixed an issue where the content could be uploaded for a not existing attachments entity. 

## Version 3.2.0

### Added

- Implemented integration with additional cloud providers for attachment storage:
    - Azure Blob Storage (`kind: azure`).
    - Google Cloud Platform Object Store (`kind: gcp`).
- Added support for mTLS authentication for the malware scanning service.
- Added criticality status to the attachment scan status.
- Provided translations for all SAP-supported languages.

## Version 3.1.0

### Added

- Introduced a sample application in the `/tests/` folder to facilitate local development and testing.

### Fixed

- Resolved a memory leak that could occur during the malware scanning process.
- Ensured reliable deletion of all related attachments when parent entities are removed, preventing orphaned data.
- Improved handling of attachment deletion for non-draft entities to ensure consistent cleanup.

## Version 3.0.0

**BREAKING CHANGE:** Replaced usage of the CAP `req` variable with `cds.context` throughout the codebase.

### Fixed

- Resolved a crash in the malware scanning process when running the CDS server in a multitenancy setup.
- Corrected missing translations for column labels.
- Scan states are now translated.

### Added

- Deprecated `@attachments.disable_facet`
- Introduced support for @UI.Hidden, enabling dynamic hiding of the attachments section in the UI.

## Version 2.2.2

### Added

- Enhanced logging capabilities by introducing a logging wrapper, providing more comprehensive and structured output to facilitate easier debugging and troubleshooting.

### Fixed

- Resolved an issue in hybrid mode where an incorrect route path variable was used for attachment uploads in local environments.

## Version 2.2.1

### Fixed

- Ensured content is correctly stored and retrievable in non-draft mode.

## Version 2.2.0

### Added

- Support for the `standard` plan of the SAP Object Store in multitenant mode. The plugin now attempts to use the `standard` plan and falls back to the deprecated `s3-standard` plan if needed.
- Added support for non-draft attachment handling.

### Fixed

- Improved error handling and runtime crashes.
- Fixed support for MTLS authentication via Service Manager.

## Version 2.1.2

### Fixed

- Bug fixes.

## Version 2.1.1

### Added

- MTX: Support for deleting tenant-specific objects from S3 upon tenant unsubscription in shared mode.

### Fixed

- Deleted attachments are now removed from S3 when a draft is discarded or deleted.

## Version 2.1.0

### Added

- Support for multitenancy with tenant specific object store instances as the default option.

### Fixed

- Support for `.mov` file extension.

## Version 2.0.2

### Fixed

- Restored Attachments aspect on root namespace.

## Version 2.0.1

### Fixed

- Minor bug fixes.

## Version 2.0.0

### Changed

- Removed `@sap/xsenv` dependency.
- Attachments usage changed to `using { sap.attachments.Attachments } from '@cap-js/attachments'`.

### Added

- **Visibility Control**: Added visibility control for attachments plugin using `@attachments.disable_facet`.

## Version 1.2.1

### Fixed

- CDS version check added for rendering UI facets in older versions.

## Version 1.2.0

### Added

- Support for multi-tenant applications utilizing a shared `object store` instance.

### Fixed

- Fixed query syntax error for hana cloud bindings.

## Version 1.1.9

### Added

- **File Size Validation**: Introduced a new file size validation feature to ensure uploaded attachments comply with defined size limits.
- This feature is compatible with SAPUI5 version `>= 1.131.0`.

### Fixed

- Fixed upload attachment bug after cds `8.7.0` update.

## Version 1.1.8

### Changed

- Included test cases for malware scanning within development profile.

### Fixed

- Fix for viewing stored attachment.

## Version 1.1.7

### Fixed

- Fix for scenario where an aspect has a composition.

## Version 1.1.6

### Added

- Support for cds 8.

### Fixed

- Fix for adding note for attachments.

## Version 1.1.5

### Changed

- Set width for columns for Attachments table UI.
- Scan status is mocked to `Clean` only in the development profile and otherwise set to `Unscanned`, when malware scan is disabled.
- When malware scan is disabled, removed restriction to access uploaded attachment.

## Version 1.1.4

### Changed

- Updated Node version restriction.

## Version 1.1.3

### Changed

- Improved error handling.

### Fixed

- Minor bug fixes.

## Version 1.1.2

### Added

- Content of files detected as `Infected` from malware scanning service are now deleted.

### Changed

- Attachments aren't served if their scan status isn't `Clean`.
- Reduced the delay of setting scan status to `Clean` to 5 sec, if malware scanning is disabled.

### Fixed

- Bug fixes for event handlers in production.
- Bug fix for attachment target condition.

## Version 1.1.1

### Changed

- Enabled malware scanning in hybrid profile by default.
- Added a 10 sec delay before setting scan status to `Clean` if malware scanning is disabled.

### Fixed

- Bug fixes for upload functionality in production.

## Version 1.1.0

### Added

- Attachments are scanned for malware using SAP Malware Scanning Service.

### Fixed

- Fixes for deployment

## Version 1.0.2

### Fixed

- Bug fixes

## Version 1.0.1

### Fixed

- Updating the documentation.

## Version 1.0.0

### Added

- Initial release that provides out-of-the box asset storage and handling by using an aspect Attachments. It also provides a CAP-level, easy to use integration of the SAP Object Store.

# Change Log

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](http://semver.org/).
The format is based on [Keep a Changelog](http://keepachangelog.com/).

## Version 1.1.2

### Added

- Content of files detected as `Infected` from malware scanning are now deleted.

### Changed

- Attachments aren't served if their scan status isn't `Clean`.
- Reduced the delay of setting scan status to `Clean` if malware scanning is disabled to 5 sec.

### Fixed

- Bug fixes for event handlers in production.

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

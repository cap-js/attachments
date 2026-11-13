# Contributing

## Code of Conduct

All members of the project community must abide by the [Contributor Covenant, version 2.1](CODE_OF_CONDUCT.md).
Only by respecting each other we can develop a productive, collaborative community.
Instances of abusive, harassing, or otherwise unacceptable behavior may be reported by contacting [a project maintainer](.reuse/dep5).

## Engaging in Our Project

We use GitHub to manage reviews of pull requests.

- If you are a new contributor, see: [Steps to Contribute](#steps-to-contribute)

- Before implementing your change, create an issue that describes the problem you would like to solve or the code that should be enhanced. Please note that you are willing to work on that issue.

- The team will review the issue and decide whether it should be implemented as a pull request. In that case, they will assign the issue to you. If the team decides against picking up the issue, the team will post a comment with an explanation.

## Steps to Contribute

Should you wish to work on an issue, please claim it first by commenting on the GitHub issue that you want to work on. This is to prevent duplicated efforts from other contributors on the same issue.

If you have questions about one of the issues, please comment on them, and one of the maintainers will clarify.

## Local development setup

`./tests/incidents-app/` contains a working sample with which the plugin can be locally tested and which is used by the integration tests.

`cd ./tests/incidents-app/` into the app and run `cds watch` within the folder to have the Incidents app running but with the local version of the plugin.

If you want to test your implementation against the BTP Object Store or the Malware Scanning Service, use [`cds bind`](https://cap.cloud.sap/docs/advanced/hybrid-testing) and run with `cds watch --profile hybrid` to test those changes.

If you are prompted locally for authentication use CAPs local development mock values of "alice" and "1234".

## Running tests locally against BTP service instances

Some integration tests are guarded by `isNotLocal` — they are skipped when `cds.env.requires.attachments.kind` is `"db"` (the default for local development) and only run when a real object store backend is configured.

### Using real BTP services via `cds bind` (local SQLite database)

Prerequisite:

- malware-scan-instance and object-store-instance available in targeted btp space.
- logged in into cf.

This setup uses the BTP Malware Scanning Service and Object Store from your BTP account, while keeping the database local (SQLite). This is the simplest way to run the `isNotLocal` tests without needing a HANA HDI container.

First deploy a local SQLite database. This avoids HANA connection errors when the hybrid profile is active, since CAP will use the deployed `db.sqlite` file as the database instead of attempting to connect to HANA:

```sh
cd tests/incidents-app && cds deploy --to sqlite && cd -
```

Make sure `tests/incidents-app/package.json` has the SQLite db configured for the hybrid profile. The `audit-log` entry redirects audit log output to the console — without it the tests fail because no audit log service is bound. Add the following inside the `"requires"` block:

```diff
  "requires": {
+   "[hybrid]": {
+     "db": {
+       "kind": "sqlite",
+       "credentials": {
+         "url": "db.sqlite"
+       }
+     },
+     "audit-log": {
+       "kind": "audit-log-to-console"
+     }
+   },
    "queue": {
```

Then bind the required BTP services and run the tests via `cds bind --exec` so the bound credentials are injected:

```sh
cds bind --profile hybrid <object-store-instance>    # binds your BTP Object Store instance
cds bind --profile hybrid <malware-scanner-instance> # binds your BTP Malware Scanning Service instance
cds bind --profile hybrid --exec -- npx jest --runInBand
```

### Using real BTP services via `cds bind` (HANA database)

Prerequisite:

- malware-scan-instance, object-store-instance and hana-instance available in targeted btp space.
- logged in into cf.

This setup uses the BTP Malware Scanning Service, Object Store and HANA from your BTP account.

First deploy to a hana-hdi container.

```sh
cd tests/incidents-app && cds deploy --to hana && cd -
```

Then bind the required BTP services and run the tests via `cds bind --exec` so the bound credentials are injected:

```sh
cds bind --profile hybrid <object-store-instance>       # binds your BTP Object Store instance
cds bind --profile hybrid <malware-scanner-instance>    # binds your BTP Malware Scanning Service instance
cds bind --profile hybrid <hana-hdi-container-instance> # binds your hana-hdi-container-instance created above
cds bind --profile hybrid --exec -- npx jest --runInBand
```

## Contributing Code or Documentation

You are welcome to contribute code in order to fix a bug or to implement a new feature that is logged as an issue.

The following rule governs code contributions:

- Contributions must be licensed under the [Apache 2.0 License](./LICENSE)
- Due to legal reasons, contributors will be asked to accept a Developer Certificate of Origin (DCO) when they create the first pull request to this project. This happens in an automated fashion during the submission process. SAP uses [the standard DCO text of the Linux Foundation](https://developercertificate.org/).

## Issues and Planning

- We use GitHub issues to track bugs and enhancement requests.

- Please provide as much context as possible when you open an issue. The information you provide must be comprehensive enough to reproduce that issue for the assignee.

# `@cap-js/attachments` — Developer Knowledge Base

*Written for someone joining the team cold. Assumes familiarity with SAP CAP but not this plugin specifically.*

---

## What this is

A CAP `cds-plugin` that adds file attachment storage to any CAP application. Consumers annotate their CDS model; the plugin wires up upload, download, malware scanning, and deletion automatically — no custom handlers needed.

Published as `@cap-js/attachments`. Requires `@sap/cds >= 9`.

---

## Two attachment modes

The plugin supports two fundamentally different ways to attach files. Almost every code path forks on this distinction, so understand it first.

### Composition-based (the original mode)

A separate `Attachments` child entity is composed onto the parent:

```cds
entity Incidents {
  attachments : Composition of many Attachments;
}
```

Files live in their own DB table (or object store row). The UI gets a `@UI.LineItem` facet auto-injected by the plugin. Supports multiple files per parent entity.

### Inline (added later)

Attachment fields are embedded directly on the parent entity using a naming convention — fields sharing a common prefix: `_content`, `_filename`, `_status`, `_url`, `_hash`, `_mimeType`, `_lastScan`:

```cds
entity Invoices {
  invoice_content  : LargeBinary @Core.MediaType: invoice_mimeType;
  invoice_filename : String;
  // ... etc
}
```

**Why inline exists and not "Composition of one":** Two concrete reasons:

1. Fiori Elements does not support drafts with a Composition of one out of the box — you would need a custom handler just to make the basic creation flow work.
2. CAP does not automatically wire the FK when PATCHing a parent that has a Composition of one child — application developers would need to fill it in manually in a custom handler on every upload.

Inline keeps both of those implementation details inside the plugin rather than leaking them to the application developer. The plugin detects which mode is active via the `@_is_media_data` annotation on the element or entity.

**Practical choice:** Use composition when users upload multiple files. Use inline for a single attachment slot (e.g. a profile photo, a single required document).

---

## Entry points

```
cds-plugin.js          ← plugin entry point; require()d by CAP at startup
  lib/plugin.js        ← all handler registration; the main logic file
  lib/mtx/server.js    ← MTX sidecar: tenant subscribe/unsubscribe → object store lifecycle
```

`package.json` `"main": "cds-plugin.js"` combined with the `cds-plugin` package naming convention causes CAP to auto-load this at startup without any explicit `require`.

---

## How the plugin hooks in

**Model phase** — `cds.on("compile.to.edmx", unfoldModel)` runs after CSN compilation. `unfoldModel` auto-injects `@UI.Facets` and `@UI.FieldGroup` annotations so the attachments section appears in Fiori Elements UIs without consumers having to write annotations. It also auto-applies `@Core.ContentDisposition` metadata for inline attachment content fields.

**Service phase** — `cds.ApplicationService.handle_attachments` is set as a service `impl` mixin. CAP calls this for every `ApplicationService` that has attachment entities. It registers the full set of CRUD handlers: validate, read, PUT, CREATE, DELETE, and min/max composition validation.

**DB layer intercept** — After all services are served, `db.prepend()` registers two DB-level handlers:

- `db.on("INSERT")` — intercepts attachment inserts that carry content, redirects them to the `attachments` service (i.e. to object store) instead of letting them write content natively to the DB.
- `db.on("SELECT")` — when a SELECT includes a `content` column and the kind is not `db`, fetches the actual binary from object store and injects it into the result rows.

These are registered once at the DB layer rather than per-service because the storage redirect needs to happen regardless of which service triggered the operation.

---

## Entity metadata: the `_attachments` computed property

[`lib/csn-runtime-extension.js`](lib/csn-runtime-extension.js) patches `cds.builtin.classes.entity.prototype` via `Object.defineProperty` to add a computed `_attachments` property. This is the standard CDS extension pattern for attaching computed metadata to all entity definitions at runtime, making `entity._attachments` available naturally anywhere a CDS entity definition is passed around (including inside CAP internals).

The property returns an object with:

| Property | Description |
|----------|-------------|
| `isAttachmentsEntity` | True if this entity itself is a media data entity (`@_is_media_data`) |
| `hasAttachmentsComposition` | True if any composition path leads to an attachment entity (memoized) |
| `attachmentCompositions` | All composition paths (arrays of element names) leading to attachment entities |
| `inlineAttachmentPrefixes` | List of inline field prefixes on this entity (memoized) |
| `hasInlineAttachments` | True if any inline prefixes exist (memoized) |

**The memoization pattern** (`delete this.X; this.X = computed; return this.X`) is the standard CDS idiom for lazy-computed, self-replacing getters on linked entity objects. It avoids re-running the composition tree walk on every access. `attachmentCompositions` is intentionally *not* memoized because composition paths can change between model reloads (relevant in MTX multitenancy).

---

## Storage backends

Configured via `cds.env.requires.attachments.kind`:

| Kind | Used when |
|------|-----------|
| `db` | Development default, or when explicitly set |
| `standard` | Production — auto-detects cloud provider from credential shape |
| `attachments-s3` / `attachments-azure` / `attachments-gcp` | Explicit cloud provider |

**`standard` auto-detection** ([`lib/helper.js:133`](lib/helper.js#L133)): Sniffs `objectStore.credentials` for `access_key_id` (AWS), `container_name` (Azure), or `projectId` (GCP). If none match, falls back to `"aws-s3"` — this is intentional (AWS was the first supported backend) but will produce a cryptic AWS SDK error rather than a clear message if credentials are actually missing or misconfigured. No warning is logged on this fallback (see open questions).

[`srv/attachments/standard.js`](srv/attachments/standard.js) is a 6-line loader that calls `getAttachmentKind()` at module load time and `require()`s the right backend.

**Cloud SDKs are optional peer dependencies** (as of v4.0.0). Consumers must install only the SDK for the provider they use (`@aws-sdk/client-s3`, `@azure/storage-blob`, or `@google-cloud/storage`). The plugin does not bundle them.

---

## Malware scanning

Integrates with the SAP BTP Malware Scanner service.

**Scan flow:** On upload → status set to `"Scanning"` → file streamed to scanner → status updated to `"Clean"` or `"Infected"` → if infected, `DeleteInfectedAttachment` event emitted → content nulled out in DB, file deleted from object store.

**Authentication:** Supports mTLS (preferred) and basic auth (deprecated — logs a warning on every scan). Certificate expiry is checked on each request: warns at 30 days remaining, throws if already expired.

**Retry:** Configurable exponential backoff with jitter on 429 responses.

| Config key | Default | Description |
|-----------|---------|-------------|
| `maxAttempts` | 5 | Max retry attempts |
| `initialDelay` | 1000ms | First retry delay |
| `maxDelay` | 30000ms | Retry delay cap |
| `maxConcurrentScans` | 30 | Semaphore limit for concurrent scans |

**Scan expiry:** `scanExpiryMs: 259200000` (3 days). Controls how long a `"Clean"` status is considered valid before re-scanning.

**Mocked scanner:** In the `[development]` profile, `malwareScanner-mocked` is used automatically. See [`srv/malware-scanner/malwareScanner-mocked.js`](srv/malware-scanner/malwareScanner-mocked.js).

---

## Deletion and the outbox

Deletions follow a two-phase pattern within a single request:

1. `before DELETE/UPDATE` — `attachDeletionData` collects all affected object store URLs into `req.attachmentsToDelete`
2. `after DELETE/UPDATE` — `deleteAttachmentsWithKeys` emits `DeleteAttachment` for each URL

The `attachments` service is configured with `outboxed: true`. The `emit("DeleteAttachment")` is written to the CDS outbox DB table in the same transaction as the entity delete, giving roughly **at-least-once** deletion semantics. A process crash after the entity delete but before the object store delete is processed will still result in eventual deletion via outbox retry.

**Remaining orphan risk:** If the object store keeps returning permanent errors, the outbox may eventually stop retrying, leaving orphaned files. There is no periodic cleanup sweep.

---

## Draft support

The plugin has deep CAP Fiori Draft integration.

**Composition attachments in draft:** Files uploaded during draft editing are stored in the draft shadow table. On `SAVE` (`draftActivate`), `draftSaveHandler` copies them to the active entity and triggers a fresh malware scan.

**Inline attachments in draft:** The malware scan runs during the draft phase. For the DB backend, `putInlineAttachmentDb` handles this synchronously. For object store backends, the outbox is used.

**Deletion tracking:** Draft-aware deletion logic handles three distinct cases: active entity deleted with no open draft, draft discard, and draft activate with removed attachments. Each case requires different logic to determine which URLs to delete from object store.

**`move_media_data_in_db` flag** ([`srv/attachments/basic.js:267`](srv/attachments/basic.js#L267)): When `cds.env.fiori.move_media_data_in_db` is true, the SAVE handler is skipped entirely — the plugin trusts CAP to copy the data itself. The exact semantics of this flag are an open question (see below).

---

## Multi-tenancy (MTX sidecar)

[`lib/mtx/server.js`](lib/mtx/server.js) hooks into `cds.xt.DeploymentService` subscribe/unsubscribe events. Only active when running as an MTX sidecar (`profiles.includes("mtx-sidecar")`).

**`objectStore.kind: "separate"`** (production default): Each tenant gets their own object store instance provisioned through SAP Service Manager. Subscribe → create instance → bind. Unsubscribe → unbind → delete instance.

**`objectStore.kind: "shared"`**: All tenants share one object store. Tenant isolation is achieved by prefixing object keys with `tenantId_`. On unsubscribe, all objects with that tenant prefix are deleted (per-provider cleanup for S3, Azure, and GCP).

For shared mode, the URL stored in DB is `${tenantId}_${uuid}` instead of just `${uuid}` — this prefix is what enables the tenant-scoped cleanup.

---

## `@Validation.MinItems` / `@Validation.MaxItems`

A general composition validation feature, not attachment-specific. Attach to any composition:

```cds
attachments : Composition of many Attachments @Validation.MinItems: 3;
```

Useful for forms that require a minimum number of documents before submission (e.g. "requires documents X, Y, and Z → set MinItems: 3").

Validates on CREATE, UPDATE, DELETE, and draftActivate. In draft context, violations produce `warn` (user can keep editing); outside draft, they produce `error` (request rejected).

Supports static number values and dynamic CQL expressions (via `xpr`). Custom i18n message keys can override default error messages per entity and field using the pattern `MinimumAmountNotFulfilled|EntityName|fieldName`.

The `stringifyValues` helper works around a HANA requirement that numeric values in CQL expressions be passed as strings — whether this workaround is still needed is an open question (see below).

---

## Filename deduplication

Controlled by `cds.env.requires.attachments.deduplicateFileNames` (default: `true`).

When a file named `report.pdf` is uploaded but `report.pdf` already exists for that parent entity, the new file is renamed to `report-1.pdf`. A further upload becomes `report-2.pdf`. If `report-1.pdf` exists without `report.pdf`, the next upload becomes `report-1-1.pdf` — the suffix is applied to the incoming name as-is.

Implementation performs a single DB query per batch using DB-dialect-specific `ORDER BY` to sort by numeric suffix (HANA, Postgres, and SQLite each have different regex functions). This avoids N+1 queries even for bulk uploads.

---

## Test structure

```
tests/
  incidents-app/       ← full CAP test application (incidents domain)
  integration/         ← integration tests per feature area (draft, non-draft, single, rename, features)
  unit/                ← unit tests for individual functions
  utils/               ← shared test helpers
```

Run: `npm test` (SQLite), `npm run test:postgres` (Postgres, requires `CDS_ENV=pg`).

---

## Open questions for the team

The following could not be answered during the handover and should be resolved with the original authors.

| # | Location | Question |
|---|----------|----------|
| 1 | [`lib/plugin.js:28`](lib/plugin.js#L28) | Why does the attachment intercept sit at the DB layer (`db.on("INSERT")`, `db.on("SELECT")`) rather than being registered per `ApplicationService`? What specific problem forced it down to this level? |
| 2 | [`lib/csn-runtime-extension.js:79`](lib/csn-runtime-extension.js#L79) | Why patch `cds.builtin.classes.entity.prototype` directly rather than using a standalone helper function? Is the intent that `_attachments` must be accessible inside CAP internals where only the entity definition object is in scope? |
| 3 | [`lib/plugin.js:265`](lib/plugin.js#L265) | `// const csnCopy = structuredClone(csn) // REVISIT: Why did we add this cloning?` — what mutation in `unfoldModel` was this protecting against, and why was it removed? |
| 4 | [`lib/helper.js:143`](lib/helper.js#L143) | When `getAttachmentKind()` falls back to `"aws-s3"` with no matching credentials, no warning is logged. Should there be one? Without credentials, the first upload will fail with a cryptic AWS SDK error. |
| 5 | [`lib/plugin.js:718`](lib/plugin.js#L718) | `// REVISIT: once cap-js/hana stringifies the values because HDB requires it` — is `stringifyValues` still needed, or has the upstream HANA adapter been fixed and this is now dead code? |
| 6 | [`srv/attachments/basic.js:267`](srv/attachments/basic.js#L267) | When is `cds.env.fiori.move_media_data_in_db` true? Does it signal that CAP itself will handle the draft-to-active content copy, making the plugin's SAVE handler redundant? Is this the expected default in recent CAP versions? |

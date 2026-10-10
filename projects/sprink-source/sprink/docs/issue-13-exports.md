# Issue 13: revision-bound PDF/CSV exports

This is an integration-ready export module, not completion of the combined release.
The pushed main branch still has the single-head task model. Issues #3, #7, #10,
#11 and #12 must supply saved work-package outputs and browser actions. This change
adds no invented mapping from single-head tasks to full sprinkler work packages.

## What is implemented

- Server-owned `ExportSnapshot` DTO with drawing/model, selection, catalog, engine,
  rules, evidence and output binding. Stored derived-output binding must match.
- Immutable, restart-readable PDF, BOM CSV, cut-list CSV and JSON manifest on disk.
- Numbered XY and XZ plan views, piece/joint reference tables, materials, cuts,
  ordered assembly operations, findings, source references and unresolved items.
- Adaptation before/after views plus supplied added/removed/retained/proposed-reuse,
  cut/joint and operation changes. The exporter does not calculate or invent deltas.
- Repeated table headers, splitting of oversized rows, page numbers and draft labels.
- Explicit null/unknown cuts and quantities. A known zero is preserved as zero.
- UTF-8 BOM and RFC 4180 CSV quoting; formula-leading text is apostrophe-prefixed.
- Full snapshot hash plus version checks at generation and current-only download.
  A changed field is caught even if its producer forgot to bump the version.
- Existing `/api/*` bearer-token boundary covers the optional routes when mounted
  through `createApp`. Content-Disposition is an allowlisted filename; no-store
  prevents stale browser caching. File SHA-256 checks detect corrupted artifacts.

## Integration for Yu

Construct `WorkPackageExports` once in the server composition root and pass it as
`workPackageExports` to the existing `createApp(service, options)` call:

```ts
import { WorkPackageExports } from './exports/service.js';

const workPackageExports = new WorkPackageExports({
  directory: join(dataDirectory, 'work-package-exports'),
  loadCurrent: async packageId => {
    // Required adapter from #7: authorize project access, then load saved inputs
    // and derived outputs at one consistent revision. Return null if inaccessible.
    // Return ExportSnapshot; preserve the ACTUAL stored derivedBinding.
    return workPackageStore.exportSnapshot(packageId);
  },
  // Required for Japanese/non-ASCII project text. Supply an appropriate licensed
  // Unicode TTF/OTF installed on the server, with glyphs covering the project text.
  // pdf: { fontPath: '/path/to/font.ttf' },
});
createApp(existingFieldService, { token, webDir, workPackageExports });
```

`workPackageStore` above is the missing adapter, not an existing repository symbol.
Without this option the old app's routes/behavior remain unchanged. Never expose
`exportRoutes` outside the authenticated host or pass client-submitted snapshots.
The current token model is application-wide. If #7 adds per-user authorization,
its adapter must preserve those caller/project boundaries before returning data.

1. `POST /api/work-packages/:id/exports`, body `{ "expectedBinding": <binding from current UI> }`.
   Returns 201 with manifest and exportId. Stale inputs/outputs return 409.
2. `GET /api/work-packages/:id/exports/:exportId/work-package.pdf`.
3. Same path for `bom.csv`, `cut-list.csv`, or `manifest.json`.
4. Show an export failure as recoverable. On 409 reload the package and ask for a
   new export; never relabel an old artifact as current. The GET path rechecks all
   inputs after file I/O. Once bytes have reached a recipient they are a static,
   explicitly revision-labeled document, not a live claim of currentness.

IDs must be 1-128 ASCII letters/digits/underscore/hyphen. This matches the existing
safe-ID style. Configure a writable export directory beneath the server data root.
Successful bundles are immutable. Failed generation cleans its temporary directory;
there is no automatic historical bundle retention/deletion policy in this module.

## Producer contract

Read `apps/server/src/exports/types.ts`. Versions are supplied by the domain layer;
`derivedBinding` is the binding persisted WHEN outputs were computed. Do not fill
it from the latest input binding when adapting stale results. `outputVersion`
identifies the complete quantities/assembly/findings/delta set used for this export.
Use the deployed configVersion to bind all output-affecting rules/templates/catalogs.

All numbers retain their supplied precision. Units belong to every numeric row and
plan coordinate frame. The exporter performs no unit conversions, tolerances,
thread makeup, cut arithmetic, product compatibility or engineering approval.
Provide installed materials, not purchasing stock, unless explicitly described.
Null numeric values require unresolved/unsupported status and a reason. Known
values must be finite and non-negative. Sources must resolve to the source index;
selected cut/assembly references must resolve to pieces, segments and joints.
The baseline may reference removed pieces absent from the selected cut table.

Assembly instructions and delta descriptions are supplied verbatim. Supply a
source-backed fixed procedure from the domain engine. No instructions, conditions
or product dimensions are generated by the export module.

Every document remains DRAFT. User selection, complete rows and passing findings
never create an approval stamp. Missing verification stays visible in the PDF,
manifest and repeated CSV `package_unresolved_items` field. This exporter does not
promote or overwrite the underlying project's separate approval state.

Default PDF font is Helvetica for the English demo. Non-ASCII snapshots fail with
422 unless a Unicode font is configured; CSV always preserves Unicode. Fonts are
not downloaded dynamically. Verify glyph coverage when deploying a custom font.

CSV columns include revision metadata, `record_type`, status, units, source IDs,
unresolved reason and document status. ID collections are JSON arrays inside
quoted cells to avoid ambiguous delimiters. Empty tables have one
`record_type=package_status` row with blank quantity and explicit unresolved status.
Do not sum that row as a material. Ordinary rows are `material` or `cut`.

# #12 local acceptance record — 2026-09-27 UTC

This is software evidence, not field acceptance. #12 remains incomplete/Draft. Base dependency: #31 at `d0d604c`; #30 closure was read but is not production-wired by this change.

## Verified locally

- Workspace typecheck and production web build pass. Existing Vite bundle-size warning remains.
- Full suite: **686 passed, 9 existing skipped**, 30 files. The skips are existing planning compatibility placeholders, not claimed acceptance.
- Real work-package service / Pi integration creates an adaptation package independently, generates two routes, requires selection, computes full active-interval outputs/delta and creates PDF/BOM/cut/manifest artifacts. Changed obstacle facts keep baseline identity and block stale candidate selection/downloads. Existing cancellation/late-result and project-access tests also pass.
- Synthetic L-shaped context fixture, explicit 0/31/90-degree transforms, translation and ft conversion: independently expected extra lengths 2.8/3.3 m and four added elbows. Retained pipe, corner, terminal head and connections are unchanged. Incomplete transform, interior context, multiple active IDs, moved generated endpoint, missing height and bounded no-route are covered.
- Frozen FS-01 P27: two steel routes from the #1 fictional box/work bounds, **+1550 mm / +1750 mm**, four elbows each. Those are this generator's midpoint lanes (+775/-875 mm), not the independently supplied #1 reference route coordinates. Catalog OD is 2.375 in = 60.325 mm; the #1 numerical geometry assumption was 60.3 mm. Lane lengths cancel the radius here; lead-in positions differ accordingly. All other 82 saved pipe-graph entities, including H1/H3 and P28/P30, remain retained. Scope stations remain scope stations; steel cuts are null; no CPVC parts or SF basis are supplied.

## Browser observations

Used the actual built app and authenticated local server, seeding **inputs only** through the normal API. No result JSON or fake success responses were injected.

1. Synthetic CPVC control: generated 2 alternatives, explicitly selected A, inspected active-interval full quantities and delta, created/downloaded the revision-3 PDF/CSV bundle. This proves UI plumbing, not steel construction.
2. FS-01 source projection + fictional supplement: generated 2 steel alternatives; selected A; recorded missing work-area access as unavailable (no invented measurement); rebuilt for revision 4; created its draft export. Screenshot shows the explicit fictional/sample label, retained context and unresolved status.
3. Corrected issues observed during this check: retained pipes rendered as proposed new work; context incorrectly requested fabrication inputs; full-source fit made the active interval too small; route badge anchored to retained context; steel screen asked for CPVC cure and offered only SF jurisdiction. The current UI limits detailing prompts to the interval, uses a focused work-area view and leaves non-SF project intake to the shared boundary.

Screenshots: [synthetic comparison](comparison.png), [synthetic export](export.png), [FS-01 comparison](fs01-comparison.png), [FS-01 export](fs01-export.png).

Synthetic PDF pages 1–2 and 18–19 were rendered and visually inspected. Context has distinct C labels/tables, endpoint cuts stay unresolved, CSV parsed as five active cut rows. This is not exhaustive multi-page/public-release PDF acceptance; long repeated unknown sections and dense full-drawing context remain a handoff usability limitation.

## Reproduce

From `sprink`, install locked dependencies and build. Start a dedicated local test server (choose a free port and new data directory):

```sh
SPRINK_DATA_DIR=/tmp/issue12-review SPRINK_TOKEN=local-review-only PORT=4312 pnpm start
```

In another terminal:

```sh
SPRINK_TOKEN=local-review-only pnpm exec tsx apps/server/scripts/seed-adaptation-demo.ts
SPRINK_TOKEN=local-review-only pnpm exec tsx apps/server/scripts/seed-adaptation-demo.ts --fs01
```

The seed prints a package URL. Connect using that local test token, generate, select and export. `--fs01` loads the repository's frozen source crop/model and explicit hypothetical product/horizontal/duct/workspace supplement. It is not arbitrary drawing intake or field evidence. Each seed creates a new package; no existing package is overwritten.

## Still required for acceptance

- #27/#28/#11 actual arbitrary PDF/image calibration, tracing, scope/site/transform intake and common UI integration. Source image overlay/calibration is distinct from this saved-coordinate schematic.
- Actual MSU FP2.1 trace with reviewed numerical lengths and a saved fictional supplement; the synthetic L topology is a portability test, not an MSU field/browser pass.
- Manual candidate editing, a reviewed one-route browser case, broader phone UX and #8 combined source-case acceptance.
- #30/#29 persisted closure proposal and UI integration; product/physical datums, fixed-end assembly evidence and practitioner review. Engine counts are modeled spans; final physical pieces/purchasing can differ.
- Protected-context clearance/support/hydraulic/code review; known retention alone establishes none of those checks. No actual site measurements, practitioner sign-off, live JEV accuracy or deployment are claimed.

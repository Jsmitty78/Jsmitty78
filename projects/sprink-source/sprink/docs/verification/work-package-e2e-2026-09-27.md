# Work-package fixes: verification record

Verified on 2026-09-27 UTC against the production web build and an isolated
localhost server/database. The existing development server and its data were
not changed. These are software acceptance results, not construction approval.

## Browser workflows

Each row started with a new package and an actual PDF upload, page/view
selection, scale calibration and manual trace. No generated route was supplied
as an input. Every workflow produced PDF, BOM CSV, cut CSV and manifest files.

| Workflow | Result |
| --- | --- |
| FS-01 preparation | P27 projected length 3047.661333 mm; NPS 2 steel selected; H1/H3 and adjacent P30/P28 retained as context. Material notes reference page 2; nominal size references page 1. |
| MSU preparation | Two projected legs, 1236.133333 and 728.133333 mm; products remain unknown; terminal head retained outside purchase quantities. |
| FS-01 adaptation | Missing outside diameter produces a specific input request. Reopen trace, select steel, reconfirm, enter synthetic site geometry, generate two alternatives, select and export. Independently calculated centerline increases: 1550 / 1750 mm. |
| MSU adaptation | Independent L-shaped trace, supplemental CPVC catalog assumption and synthetic site geometry produce four alternatives. Select and export while preserving the other leg, corner and terminal head. Centerline increases: 350 / 350 / 730 / 730 mm. |

Both drawings used the printed scale 1/8 inch = 1 foot (33.8666667 mm/PDF point).
Manual source points were FS-01 page 1: (1830.4, 1784.07) to
(1830.4, 1874.06), and MSU page 3, right new-work view:
(1949, 1130), (1949, 1166.5), (1927.5, 1166.5).

Input PDF SHA-256 values:

- FS-01/FS-02: `a21d5748d0b7f15bea1da772fdb41a424651cb1e717534177b5144c6d51eef1f`
- MSU Extrusion Lab Addendum 1: `e15619951310b03ff676a1cdb3b695d74f033d0cfd9881a8e57b1b190eea114d`

The adaptation frame was explicitly aligned to the selected span; drawing Z
was labeled an assumed horizontal test plane. Geometry inputs below are in mm,
in that local frame, and were saved as synthetic/proposed:

| Case | Obstacle min / max | Work bounds min / max | Surface clearance |
| --- | --- | --- | --- |
| FS-01 | (1200,-250,-300) / (1800,250,300) | (-150,-1400,-200) / (3197.661333,1200,200) | 100 |
| MSU | (300,-80,-100) / (600,80,100) | (-50,-600,-200) / (1286.133333,600,200) | 50 |

Independent arithmetic over the saved candidate coordinates checked length,
pipe outside-diameter clearance and containment within the work bounds. The
complete FS-01 source-graph API control also preserved all 82 protected
entities and 80 protected connections, without numeric purchase quantities
for that context. All physical cut lengths remained null.

## Automated and artifact verification

- `pnpm test`: 40 files, 808 tests passed, no skips.
- `pnpm typecheck`: passed for every package.
- `pnpm build`: passed; the existing large-chunk warning remains.
- Live JEV smoke: `jev-1.13.0` returned `request_input:joint_datum` for one
  synthetic Choice request. This verifies connectivity, not engineering accuracy.
- PDF pages were rendered and inspected; final changed source tables and
  schematic pages were rechecked after label-layout corrections.
- PDF/CSV file hashes and byte sizes matched the manifests. Revision bindings,
  source labels, material values, provenance and protected exclusions matched
  saved inputs.
- Editing inputs invalidated the previous artifact: its authenticated download
  returned 409 `stale_artifact`; the new revision exported successfully.
- The export dialog was checked at desktop size and 390 × 844 CSS pixels.

## Limits

The embedded browser emitted `Page.downloadWillBegin`, then canceled the local
save at zero received bytes. Its download-wait API timed out. Artifact creation,
authenticated API retrieval and file contents were verified; successful local
saving through that browser was not established.

Field measurements, steel thread engagement, physical fixed-end assembly,
practitioner review and construction approval remain unverified. Unknown facts
were not promoted to evidence. Raster/rotation/unit variants were covered by
automated tests, not all repeated manually in the browser during this run.

## PR review follow-up

The five review findings have dedicated regression coverage:

- The intake save path preserves scoped source requirements, nominal provenance
  and synthetic site assumptions during product-only changes. Geometry edits
  still invalidate scoped facts and the change request; carried nominal sizes
  retain their provenance. Newly read source labels use confirmed evidence.
- Confirmed lengths with unsupported units render as Unknown, not zero.
- Fractional nominal sizes such as `1-1/2"`, `1 1/2 in` and `1/2 inch` participate
  in catalog conflict checks; matching sizes and invalid denominators are covered.
- CSV package-wide provenance, unresolved items and protected context appear once
  in a `package_metadata` row. Quantity rows retain their revision binding and
  record type. A 100/200-fact and row regression checks linear output growth.

The follow-up suite passed 41 files / 823 tests, including authenticated export
and stale-artifact integration checks. The four manual browser workflows above
were not repeated for this follow-up.

A second review found that the separate Source requirements save action could
still promote a synthetic nominal size. That action now derives confirmation
from the selected provenance and locks existing synthetic requirements before
replacing facts, including legacy synthetic descriptions. Six regression cases
cover saved/reloaded assumptions and each provenance choice. The suite now
passes 41 files / 829 tests; typecheck and build also pass. A direct run from the
actual requirements patch through profile evaluation and export confirmed no
nominal-size conflict and preserved `synthetic_assumption` / `proposed` in the
exported fact. Browser E2E was not repeated for this correction.

## Main integration

Merged main through `c860054` (PRs #35, #36 and #37). Conflict resolution retains
preparation descriptions, projected centerline CSV values, retained-context rows
and the span-pinned site frame / plan-elevation views, alongside the provenance
and bounded CSV metadata fixes. Site editors now write explicit provenance;
synthetic values stay proposed. Changing a span invalidates synthetic geometry,
and changing its frame clears boxes whose coordinates would otherwise change
meaning. Legacy `ASSUMPTION:` records are also treated as synthetic.

The integrated tree passes 43 files / 843 tests, typecheck, build and diff checks.
Browser E2E was not repeated during this conflict resolution. The existing Vite
large-chunk warning remains.

## Server-side source requirement preservation

The server invalidator now includes `requiredConnectionMethod` and
`requiredPipeSpecification` among source facts preserved during product edits.
Two regression cases (detailing and observed facts) failed before the fix and
pass after it: authenticated product PATCH, persisted reload, source requirement
and connection-conflict evaluation, and exported provenance. Changing the drawing
revision still removes these stale source requirements. The full suite passes
43 files / 845 tests, with typecheck and diff checks passing. Browser E2E and the
web build were not repeated for this server-only correction.

## PR #39 integration

Merged main through `e22b134`, retaining the typed-run projection guard and
expanded adaptation context from #39, together with generation recovery guidance
and provenance-aware input handling from this PR. The server integration version
was advanced so earlier derived results are not reused under the changed logic.
The merged tree passes 43 files / 847 tests, typecheck and diff checks. Browser
E2E and the web build were not repeated for this server behavior integration.

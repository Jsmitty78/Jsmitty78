# Steel detailing verification (#10)

2026-09-27 UTC; implementation base `6fc29db`.

- Manufacturer submittals downloaded, SHA-256 recorded in the catalog; Fig.351
  dimension diagram/table and Wheatland dimension/listing page visually inspected.
- Independent open-spool oracles: NPS 2 cuts 564.45 / 415.05 mm; NPS 1 cuts
  583.5 / 434.1 mm. The 12 / 15 mm engagement values and spool geometry are
  explicitly invented software inputs. No physical measurement was performed.
- Source-only fixture uses 3047.6613 mm projected span, two context heads,
  unselected products and explicit scope-interface datums. It retains one modeled
  span, null cut, and unknown joints/supports/stock/head purchasing quantities.
  This fixture checks adapter behavior, not PDF intake/calibration accuracy.
- Production persisted services generated both source-only and synthetic steel
  results and PDF/BOM/cut CSV. The reviewed rendering had 6 source-only pages and
  7 steel pages. All-page contact sheets and enlarged material/cut pages were
  inspected; no clipped/overlapping table content observed. CSV parsing preserved
  empty unresolved source cut versus 0.56445 / 0.41505 m synthetic cuts. Datum
  evidence descriptions remain in the export. The numbered source sketch is still
  the existing pipe/joint view; full retained-head/source overlay acceptance belongs
  to the preparation/adaptation UI work.
- Full workspace tests: 680 passed, 9 existing skipped (29 files). After the final
  retained-context scoping and PDF-label refinement: 38 relevant service/export
  tests passed. Final all-workspace typecheck passed. Web production build passed
  with the existing large-bundle warning; no frontend changes in this PR.
- GitHub reported no checks for this branch when inspected. Local results are not
  CI, actual JEV accuracy, browser intake acceptance or construction validation.

Parallel work read-only checked: #29 PR #30 (`b71b51d`) uses the same
`steel_threaded` / NPS 2 / NPS 1 contract; #12's `yu/issue-12-adaptation` handles
interval/frame/context separately. No dependency commits are included here.
When combining, retain both material-description/provenance changes in
`integration/snapshot.ts` and the product changes alongside #12's interval
adapter changes in `integration/model.ts`. Newly generated steel joints still
need their own engagement inputs; the catalog does not supply a measured default.

Remaining acceptance: exact supplied product/listing and project suitability,
actual end preparation and scoped engagement/physical-length measurements,
practitioner-reviewed assembly and fixed-end closure (#29), production closure
intake, and FS-01/MSU browser workflows (#27/#11/#12/#28, gate #8). No issue is
closed by these software checks.

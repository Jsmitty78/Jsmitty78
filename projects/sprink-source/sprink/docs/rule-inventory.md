# Rule inventory and remaining work

Checked: 2026-09-26. This inventory describes the bounded project evaluator and its actual coverage. It is not a denominator for NFPA 13 or TFP171 completeness and never represents approval of a design or installation.

## Executable project packs

| Pack | Implemented checks | Evidence and limit |
| --- | --- | --- |
| `tyco-tfp171-head` | Six project-endpoint checks: orientation, recessed escutcheon, specified installation wrench, NPT torque, retrofit-only scope, and working pressure. | Existing `validateRules` still retains its ten legacy checks. The project endpoint omits bulb condition, factory finish, leakage, and corrosion; those legacy checks have not been deleted or silently reinterpreted. TFP171 August 2026 source. |
| `tyco-tfp171-extra` | Five bounded checks: wrench-flat engagement; sealant/hand-tightening sequence; recessed fitting-face interval; named agency and catalog-temperature table membership; body-finish/catalog-temperature availability. | Wrench/sequence are as-built checks requiring installation evidence. Product selection and recessed interval may be evaluated from a revision-linked drawing and must not be represented as inspection of an installed unit. Project-required listing, mark authenticity, ambient suitability, and full TFP171 compliance are outside the checks. [TFP171 retained specs](rule-specs/manufacturer-tfp171-wrench-flats-v1.md). |
| `sf-project-basis` | Resolves a bounded San Francisco NFPA 13 edition basis from confirmed permit facts. | Edition selection only; it does not establish all permits, amendments, adoption, or compliance. |
| `sf-supports-2025` | AB 4.15 I.2–I.3 powder-driven-stud conditions and I.4 cracked-concrete fastener qualification. | Two support-specific conditions only; no load, spacing, anchor-capacity, or structural design check. |
| `sf-local-change-2025` | Compares a proposed local change to an approved drawing: revision lineage; supported straight-pipe centerline/cut arithmetic; modeled straight-pipe-to-duct envelope; derived BOM reconciliation; limited nominal-size/connector mismatch screen; head-location/impact-neighborhood report. Source-backed checks cover AB 2.04 I.14(A), I.14(C)–(E), I.15, and I.22(A)(2) triggers/lineage. | Requires confirmed San Francisco NFPA 13-2025, wet, standard-spray, non-storage, classified hazard, and existing-system modification scope. No route search, complete CAD/fitting-body model, hydraulic solver, or overall permit/compliance verdict. [Local-change source mapping](rule-specs/local-sprinkler-change-sffd-v1.md). |

The old `sf-submittal-2025` pack is not part of the current project API. Its three proposed-submittal checks are not counted as implemented here. The selected project-head pack has six rules even though the legacy `validateRules` API still has ten.

## Local-change example and verified oracle

Run the isolated, synthetic request with `pnpm rules:evaluate docs/local-change-evaluation.example.json`. The concise oracle and limitations are in [the example note](local-change-evaluation.example.md). Current CLI output resolves its fixture scope to NFPA 13-2025 and verifies:

- The approved 4.00 m route is one pipe; the proposal is five straight segments and four elbows with 6.00 m centerline length.
- With the explicitly synthetic net takeout of 0.030 m at each of eight elbow ports, cut length is 4.00 m baseline and 5.76 m proposed, a +1.76 m change.
- Derived BOM deltas are one removed baseline pipe (−1, −4.00 m), five added pipes (+1 each, cut lengths 0.97, 0.94, 1.94, 0.94, 0.97 m), four added elbows (+1 each), and one unchanged head.
- The fixed duct and tie-ins remain the same. The baseline pipe envelope intersects the duct box; every proposed straight-pipe envelope clears it. This says nothing about sprinkler discharge obstruction or full fitting clearance.
- I.14(D) is `not_applicable` because the candidate drawing confirms no head reuse; I.15 passes only its proposed-drawing-content check. The hydraulic recalculation direction remains `unknown` without a project-specific residual-case decision. Part pressure compatibility remains source-pending.

All example evidence and project facts are synthetic fixtures. None is a real permit, approval, field record, product selection, or system calculation. The thread-makeup and system-pressure fixture values are not vendor-validated selections.

## Remaining coverage

`coverage` distinguishes supported bounded checks from unimplemented and source-pending areas. No result from one of these checks fills another gap.

| Area | Current state | What remains |
| --- | --- | --- |
| Permit adoption and project conditions | `unimplemented` | Resolve complete jurisdiction, project permits, adopted requirements, amendments, exceptions, and retained project basis. The edition helper alone does not do this. |
| NFPA 13-2025 hazard/design-method conditions (N02), spacing/coverage/wall distance (N03), ceiling rules (N04), discharge obstruction (N05), support/seismic numeric criteria (N06), hydraulics/water supply/remote area (N07), and temperature/approval requirements (N08) | `source_pending` | Incorporate the governing NFPA 13-2025 primary text and applicable San Francisco amendments, then define the necessary confirmed design inputs and independent expected results. The full governing body and full amendment context are not encoded. TIA 13-25-1 through 13-25-7 and the applicable errata require source review as part of that work. |
| TFP171 recessed fitment and installation remainder | `unimplemented` | Conditions outside the retained wrench-flat, order, and fitting-face interval checks, including broader fitment/installation conditions. |
| TFP171 approval/temperature remainder | `unimplemented` | Project-required approvals, ambient conditions, authentic unit marks, current availability, and other conditions outside the specific table lookups. |
| TFP171 installation procedure remainder | `unimplemented` | Wrench identity is a separate existing check and NPT torque remains in the six-rule project-head pack; other steps and unsupported connections remain outside the new bounded sequence checks. |
| Local-change support adequacy and hydraulic adequacy | `source_pending` / `unimplemented` | Local-change output identifies affected scope and source-backed recalculation triggers/lineage. It does not determine support suitability or hydraulic adequacy. |
| Selected component fit, pressure, and product suitability | Interface mismatch screen is supported; full compatibility is `unimplemented` or `source_pending`. | The product dossier is a candidate comparison only. Wheatland WFS-121824 gives NPS 1 dimensions and a stated pipe rating; Anvil 1101 gives a center-to-end dimension and temperature-conditioned pressure rating. Thread makeup/joint qualification and a confirmed compatible selected pair are not established. See [product candidate dossier](rule-specs/local-change-product-candidate-pair-v1.md). |

The example's straight-pipe capsule-to-AABB comparison is a geometric fact check only. It does not implement NFPA spacing, discharge obstruction, sprinkler coverage, fitting-body clearance, support capacity, or hydraulic calculations.

## Retained source records

- TYCO [TFP171, document revision August 2026](https://docs.johnsoncontrols.com/tycofire/api/khub/documents/JXGj~rL_f_FBVCY52uMTJw/content); retained design-relevant checks and source limits are recorded in [`docs/rule-specs/`](rule-specs/).
- SFFD [AB 2.04](https://sf-fire.org/media/4169), visually reviewed at printed pages 1–10 for the bounded local-change clauses and edition basis.
- SFFD [AB 4.15](https://sf-fire.org/media/3979), visually reviewed at printed page 1 for the two support checks.
- The official NFPA 13-2025 body remains a dependency for numeric layout, obstruction, support, and hydraulic implementation. The current bounded workflow does not claim that the known TIA/errata list is a complete adopted-code evaluation.

Rule status describes implemented software and source scope as of the date above. It does not determine whether an authority has approved the proposed work.

## Verification

As of 2026-09-26: the synthetic example passes through `pnpm rules:evaluate`; the representative CLI/stdin/HTTP request and known missing-input/error cases were verified; `pnpm test` passes all 479 tests across 15 files; `pnpm typecheck` passes core, server, and web; and `git diff --check` passes. These checks validate this bounded implementation only.

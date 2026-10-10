# Project evaluation contract

This JSON contract evaluates selected sprinkler-head conditions and a bounded San Francisco local-change workflow. The project API returns individual checks and a local-change report; it never produces an overall project pass or approval.

## Executable rule packs

Callers select packs explicitly in `selectedRulePacks`. Valid pack IDs are `tyco-tfp171-head`, `tyco-tfp171-extra`, `sf-project-basis`, `sf-supports-2025`, and `sf-local-change-2025`. Unknown IDs are rejected, and an empty selection is valid.

`tyco-tfp171-head` exposes six change-relevant manufacturer head checks: orientation, recessed escutcheon, installation wrench, NPT installation torque, retrofit-only models, and working pressure. The legacy `validateRules` function still returns its original ten checks unchanged. `tyco-tfp171-extra` contains five bounded source-backed checks for wrench-flat engagement, sealant and hand-tightening sequence, recessed fitting-face measurement intervals, named agency and temperature table membership, and body-finish temperature availability. Installation-history checks still require installation evidence; planned candidate facts use revision-linked drawing evidence. A recommendation remains labeled as a recommendation.

`sf-project-basis` resolves the permit-based San Francisco NFPA 13 edition separately from compliance results. `sf-supports-2025` evaluates only its two bounded AB 4.15 support conditions. `sf-local-change-2025` handles a proposed local pipe/head change against an approved baseline drawing, including explicit route geometry, a straight-pipe-to-duct envelope comparison, derived BOM reconciliation, known size/connector mismatch screening, drawing/change lineage, related source-backed SFFD checks, and explicit unknowns for NFPA layout, support design, product compatibility, and hydraulic adequacy. It does not search for routes or solve hydraulics.

## Evidence and time

Every project fact uses `Fact<T>` with confirmation and evidence IDs. Missing or unconfirmed applicability facts remain unknown; they do not become `not_applicable`. Model-originated facts cannot establish a check. Evidence IDs resolve uniquely to current records for the same project and required subjects. Non-photo records need `documentRevision`; drawing/calculation links must match the referenced document and revision. Superseded or explicitly invalidated evidence cannot support a result. Evaluation uses only the explicit `project.asOf` date and does not fetch source documents or infer expiry.

The local-change baseline, proposal, change request, affected neighborhood, and supporting calculation records are revision-linked facts. Baseline and proposed plans must refer to the same stable ducts and tie-ins unless a context change is explicitly identified and evidenced. The node graph is the only source of connectivity; crossing geometry does not create a connection. Candidate plan intent never substitutes for installation history.

## Geometry, quantities, and limits

Lengths carry `m`, `mm`, `ft`, or `in`; pressure carries `Pa`, `kPa`, `bar`, or `psi`. The local geometry calculation supports finite axis-parallel straight pipe segments, explicit fitting/tie-in takeouts, and axis-aligned duct boxes. Its collision model is a pipe centerline capsule with the pipe radius. It does not test full fitting bodies, cut-end shape, sprinkler discharge obstruction, or code clearance.

The engine derives plan item counts and pipe cut lengths from the same geometry function for each plan, then reconciles supplied BOM rows against those derived items. Missing rows stay unknown, confirmed conflicting rows fail, and unmodeled parts stay visible as unknown. A clear modeled pipe/duct envelope is not a spacing, obstruction, or design-compliance result. Any unsupported geometry or missing comparisons remain unknown.

Confirmed nominal-size, connection-standard, or connection-gender mismatches can be reported independently. Material-name equality is not used as a compatibility test. Pressure ratings can be displayed against a calculation-backed system maximum, but compatibility stays unknown while selected-product conditions and service temperature are unresolved. No NFPA numeric threshold is guessed.

## Outputs and coverage

`rules` contains individual results with existing status and target/version semantics, plus pack, subject, verification-state, source, evidence, and applicable quantity-trace metadata. `basis` is separate from `rules`. `localChange` carries geometry, head-location, BOM, pressure, changed-context, and required-artifact details. `coverage` distinguishes supported bounded checks, source-pending areas, and unimplemented work. The local-change pack's scope gate prevents its SFFD clause checks from passing when the permit edition or system profile is unresolved or outside scope; physical arithmetic remains separately reported with its own evidence state.

The broader NFPA catalog covers N01–N08 only. N09 storage/in-rack protection and N10 testing/acceptance are outside this focused project evaluator. There are no numeric NFPA layout, support, or hydraulic design rules in this slice.

## Runnable synthetic example

[`docs/local-change-evaluation.example.json`](local-change-evaluation.example.json) is a synthetic reroute around a modeled duct. It is test data, not a real permit, approved design, or installation record. Run it with `pnpm rules:evaluate docs/local-change-evaluation.example.json`; the same JSON body can be sent to `POST /api/rules/evaluate`.

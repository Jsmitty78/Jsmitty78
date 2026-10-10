# Local change evaluation contract

Checked: 2026-09-26. This contract describes the first bounded design-change workflow. It is not approval of a design, installation, or authority submittal and does not return an overall compliance verdict.

## Scope

`sf-local-change-2025` compares an approved baseline drawing with a proposed local pipe/head change in a confirmed San Francisco NFPA 13-2025, wet, standard-spray, non-storage project with a classified hazard and existing-system modification. New-system work and out-of-scope permit or sprinkler profiles do not receive an inferred pass.

The request type is [`ProjectLocalChangeInput`](../packages/core/src/local-change-contract.ts), accepted as the optional `localChange` property of [`ProjectEvaluationRequest`](../packages/core/src/project-contract.ts). Project packs remain explicitly selected through `selectedRulePacks`. The executable schemas are in [`project-schemas.ts`](../packages/core/src/project-schemas.ts); the deterministic graph and geometry contracts are in [`local-change-geometry.ts`](../packages/core/src/local-change-geometry.ts). These source files are authoritative for field names and validation.

The current model has an approved drawing reference and approval fact; an optional revised drawing reference and approval fact; a change request with affected IDs, an impact neighborhood, work/scope facts, field-only conditions, and hydraulic trigger facts; baseline and proposed plans; and optional calculation-backed system maximum and baseline/revised calculation links. A local plan identifies its drawing revision and coordinate frame, rooms, ducts, nodes, `segments`, fittings, heads, supports, and optional BOM rows. Segment facts include outside diameter, nominal size, material, pressure rating, both end connections, and explicit cut-end datums. Fitting ports identify the connected segment endpoint and carry center-to-face, insertion/thread-makeup, and connector facts. The node graph defines connectivity; coordinates that merely cross or touch do not connect pipes.

## Evidence and revisions

Facts that affect a result require confirmation and unique evidence IDs. The evaluator checks project ID, record kind, exact document/revision where required, invalidation/supersession, and the entity and plan subjects. Geometry/BOM facts must be supported for both the relevant entity and plan; a plan-level record alone does not confirm each listed entity. Impact-neighborhood evidence must cover the request and listed heads, rooms, supports, ducts, and pipe segments. A stale baseline or wrong-subject proposed fact leaves dependent results unknown. Model-originated facts cannot confirm a result.

Proposal facts remain separate from as-built facts. In particular, a planned removal cannot prove field removal, planned assembly steps cannot prove installation history, and proposed geometry cannot prove an actual field deviation. The evaluator does not fetch documents or infer that evidence expires from its age; revoked or superseded state must be explicit.

## Implemented checks and limits

The local workflow reports drawing lineage; centerline and cut-length arithmetic; baseline/proposed route quantities; a bounded straight-pipe envelope comparison to modeled duct boxes; derived BOM deltas; limited nominal-size and connector mismatch screening; head movement and impacted neighborhood; and change-triggered SFFD checks. It also records unresolved artifacts and inputs.

The numeric geometry supports axis-parallel straight segments, explicit 90-degree elbow ports, tie-in offsets, and axis-aligned duct boxes in one coordinate frame. A pipe cut uses centerline length less each confirmed fitting-port net takeout (`centerToFace - insertionOrThreadMakeup`) and explicit tie-in cut offsets. Missing product dimensions or cut-end datum remain unknown; no default makeup, fit-up allowance, or product compatibility is inferred. The BOM is derived from represented plan entities and geometry, then reconciled with supplied rows. An absent entity on one plan contributes a known zero; a missing expected row remains unknown; a conflicting supplied row fails accounting only.

Cut-length arithmetic currently supports only explicitly confirmed `center_to_center` datums at both segment endpoints, evidenced for that segment and plan on the exact drawing revision. Graph node positions are centerline stations, and the supported fitting/tie-in takeouts are applied once. Missing, unconfirmed, model-sourced, wrong-subject, or stale datum evidence leaves dependent cut lengths and BOM cut comparisons unknown; independently known part counts and centerline lengths remain reportable. `physical_pipe_end` is outside this centerline model and remains unknown; no implicit conversion or duplicate takeout is applied.

The duct calculation is a straight-pipe-radius envelope against the modeled box. It does not model full fitting bodies, irregular geometry, discharge obstruction, spacing, sprinkler coverage, or code clearance. A clear pipe envelope never resolves the separate NFPA obstruction/spacing checks.

The limited source-backed clauses are:

- AB 2.04 I.14(A): explicitly listed unused excess-pipe segments are checked against installation evidence of removal; a drawing omission is not field proof.
- I.14(C): moved heads are linked to a revised approved drawing. The check does not approve other design content.
- I.14(D): a proposed threaded-head reuse is checked against separate evidence of removal-from-fitting and welding history. A drawing confirming no reuse is not applicable to this prohibition.
- I.14(E): a confirmed as-built deviation may require recalculation and is routed for review; it is not an automatic failure or an automatic calculation trigger.
- I.15: existing configuration and riser connection are checked only when sprinklers or piping are added to an existing system.
- I.22(A)(2): named changes to remote area, hazard, or water-supply routing/backflow trigger a revised-calculation link check. When all named triggers are confirmed absent, the residual case-by-case direction remains unknown until a project-specific authority decision is recorded. Calculation lineage is not hydraulic adequacy.
- I.19(D)–(E) and I.21: the drawing/change record identifies affected pipe/fitting/support information. Center-to-center pipe sizes and lengths are sourced to I.19(E)(3). Numeric support adequacy remains unimplemented.

A small product dossier supports candidate comparison only: [pipe and 90-degree elbow candidate sources](rule-specs/local-change-product-candidate-pair-v1.md). Exact thread makeup/joint qualification and a source-confirmed compatible selected pair are absent, and Anvil's stated pressure condition depends on service temperature. Connector mismatch screening and display of reported pressure ratings do not resolve complete material, joint, product-approval, temperature, pressure, or hydraulic suitability.

## Synthetic example oracle

Run `pnpm rules:evaluate docs/local-change-evaluation.example.json`. It is a fixture, not a project record. The baseline is one 4.00 m segment; the proposed reroute has five segments, four elbows, 6.00 m centerline, and 5.76 m cut length from eight explicitly synthetic 0.030 m port takeouts. Expected derived deltas are one removed pipe (−1, −4.00 m), five added pipes (+1 each; cut lengths 0.97, 0.94, 1.94, 0.94, and 0.97 m), four added elbows (+1 each), and one unchanged head. Baseline pipe envelope intersects the fixed duct box; every proposed straight-pipe envelope clears it. The CLI result leaves pressure suitability and I.22 residual hydraulic direction unresolved. See [the short example note](local-change-evaluation.example.md).

## Not implemented or still source-pending

- NFPA 13 layout/coverage, wall spacing, ceiling, discharge-obstruction, support/seismic numeric, and hydraulic design rules remain `source_pending`; the full governing NFPA 13-2025 body and complete applicable amendments are not encoded.
- The local-change pack requests support/design review where affected, but does not evaluate support type, loads, spacing, capacity, or structural adequacy.
- It reports hydraulic recalculation triggers and drawing/calculation lineage only; it does not recalculate demand, supply, friction loss, or adequacy.
- Product pressure compatibility remains unknown until exact selected product revisions, service temperature, and each manufacturer's conditions are established. No generic listing or pipe/fitting compatibility is inferred.
- The model does not find a route, accept arbitrary CAD geometry, prove the completeness of plan/RCP submittals, or determine AHJ approval.

`coverage` in the evaluation response retains the supported, unimplemented, and source-pending distinctions. See [`rule-inventory.md`](rule-inventory.md) for the current implemented inventory and residual scope.

# Fixed-end closure: bounded draft and evidence gaps (#29)

Status: research-backed **proposal accounting**, not an executable steel installation procedure. No practitioner was interviewed, no site was measured, and no physical installation was validated for this change. Parent #1's complete steel acceptance remains open. Source FS-01 H1/H3 are scope stations, not established physical interfaces.

## Candidate and primary evidence

Candidate: Anvil Fig. 487, black cast-iron Class 125 threaded flanged union, NPS 2; NPS 1 is a separate size variation. Internal IDs `anvil/487-black-nps2` / `anvil/487-black-nps1` identify research candidates, **not verified ordering SKUs**. Neither is silently added to the supported fabrication catalog.

- Manufacturer [product page](https://www.asc-es.com/products/487-flange-union-gasket-type).
- Manufacturer [Fig. 366/487 submittal](https://www.asc-es.com/resource/366%20%26%20487%20Hex%20Coupling%20%26%20Flanged%20Union%20Submittal), revision `PS-SUB-366-487-v02 20220619`, retrieved 2026-09-27 UTC. Download SHA-256 `5047dd356b9ec5b241346e98d0ecb08d6c202db01b353ce1e7e1e40a56057019`.
- Page 2 identifies cast iron and NPT thread standards. Page 3 depicts a gasketed union and tabulates flange diameter and bolt count: NPS 2 = 5 in / 127 mm, four bolts; NPS 1 = 3¼ in (82.55 mm converted), three bolts. The printed metric diameter is rounded to 83 mm. These are **radial dimensions, not axial takeouts**.
- Page 4 gives general thread inspection, sealant and makeup guidance. It does not supply the axial datum or fixed-end assembly review required here. Thread turns must not be substituted for measured installed engagement.

This keeps the source's steel/threaded cast-iron requirement under investigation. Malleable-iron Fig. 463 and forged-steel unions are not substituted for this cast-iron candidate. Actual project suitability, pressure/service conditions, selected pipe, finish, product availability, gasket and bolt specifications remain unresolved.

## Proposed procedure, explicitly not manufacturer-certified sequencing

The bounded proposal introduces one union on one straight span. A split leaves two sides that could be assembled toward a final bolted connection. This is a mechanical hypothesis to review with a fitter; it is not evidence that either side can be rotated or placed in the actual workspace.

| Review step | Required evidence / unknown |
| --- | --- |
| Establish both fixed interfaces | Measured physical joint locations, datums, thread condition, elevations; do not use head stations as pipe ends. Isolation and temporary support conditions remain project work. |
| Choose split and sequence | For **every** threaded joint, identify the rotating component, swept volume, insertion/removal travel, wrench access and order. Determine whether an entire subassembly can rotate. |
| Prepare and assemble each side | Exact pipe/elbow/union compatibility, thread preparation, sealant selection and product-specific makeup. Preserve engagement as a measured/scoped input, not a nominal-size constant. |
| Close the flanged faces | Alignment without forced pipe displacement, space for gasket insertion, final bolt/tool access, selected gasket and fastener tightening procedure. No torque value is invented. |
| Release for installation | Named practitioner and evidence of review, assumptions/limits, independent dimensional oracle. This software does not record performed work or construction approval. |

No positive path is exposed until these missing dimensions and procedures are implemented and reviewed. Even supplying all four condition booleans cannot remove the unconditional datum/procedure/practitioner gaps.

## Implementation boundary

`deriveFixedEndClosure(input, catalog, proposal)` is exported from `@sprink/fabrication` and returns the existing `FabricationOutput`. It accepts either a baseline preparation or selected candidate; no Scenario 2 prerequisite, FS-01 IDs, drawing format or jurisdiction defaults are encoded.

- A bound project/package/plan/revision/config, selected pipe ID, supported union candidate, split piece and explicit station are required. The input is not mutated. A production caller must bump the existing input/config revision on edits and persist the proposal with that revision.
- One axis-aligned piece is split into two new fabrication pieces with the original source-segment lineage. Existing end-fitting ports and accessory links are preserved. Original endpoints remain untouched. The station is a **proposed union reference**; its two half dimensions are unknown. Arbitrary rotated drawings must first use the same explicit local-frame normalization as planning; frame conversion is not inferred here.
- The public engine produces pipe/fitting counts, cuts, callouts, operations and lineage. The union is deliberately unsupported for generic cut arithmetic; no guessed axial length or makeup enters a cut. Known projected centerline lengths survive.
- The connection map includes two threaded interfaces and a separate gasket-face joint. The latter references the same fitting/node with `portId: null`; it does not pretend to be another pipe thread. Existing outer interface joints remain visible.
- The union row denotes one assembly. Gasket and bolt rows are **included-component requirements**, not additional kit purchases; their specification/supply scope stays unresolved. No stock purchasing or unspecified nut quantity is invented.
- Four review operations supplement existing unresolved preparation/connection steps. They are review tasks, not a validated installation order. Existing subassembly grouping is preserved pending actual sequencing review; the output does not claim independently installable subassemblies.
- `compareWorkPackages` is reused; it sees added parts/joints/operations and the source-span split. No duplicate catalog or cut engine was added.
- The server export adapter now preserves material IDs and unresolved specification reasons even when the count is known. The export value status describes quantity availability, while unresolved reasons preserve unsupported product/specification conditions. Known count does not imply supported product. JSON handoff and the actual server snapshot adapter are tested; full rendered PDF/browser acceptance remains pending.

## Independent software oracles

All following geometry is invented. Neither case is FS-01 or a surveyed MSU branch.

| Input | Proposed piece centerlines | Full quantities | Delta against unsplit span |
| --- | --- | --- | --- |
| 3000 mm span, station 1000 mm | 1000 + 2000 mm | 2 pipes; 1 union assembly; included 1 gasket, 4 bolts; 5 modeled connections | +1 pipe, +1 union, +3 connections, +9 unresolved/review operations; 0 centerline change |
| 4200 mm span, station 1700 mm | 1700 + 2500 mm | Same counts | Same count/operation delta; 0 centerline change |

The 5 connections comprise 2 outer interfaces, 2 union threads and 1 gasket face. The 9 operation delta comprises 1 extra product-specific preparation review task, 2 union-thread resolution tasks, 2 component-resolution tasks and 4 closure-review tasks. **Every cut length remains null.** This is a count/projection oracle, not the missing positive steel cut/closure oracle.

Additional tests cover NPS 1's three bolts, translated/reversed local axes, ft/in inputs, adjacent elbows/accessory preservation, foreign projects, stale versions, product changes, CPVC refusal, unsupported station/frame and wrong-subject evidence.

## Parallel work and remaining acceptance

Started from `origin/main` at `6fc29db`. Read-only inspected the #10 lane (`yu/issue-10-steel-catalog`, initial catalog commit `589d08b`) and #12 lane (`yu/issue-12-adaptation`) while working. The former's public connection token is `steel_threaded`; this module accepts it without copying its catalog/engine changes. #12's protected-context work remains upstream; this module only receives an already bounded fabrication run. No hard dependency commit is included in this PR.

Remaining before #29 completion:

1. Exact approved-for-project pipe/elbow/union ordering selections, gasket/fasteners and compatibility. #10 owns steel catalog and generic engagement arithmetic.
2. Measured/sourced axial union and end-interface datums, scoped thread engagement and an independent **positive** steel dimensional oracle for two geometries.
3. Practitioner review of movement, access, support, assembly order and final closure; record reviewer/evidence without treating developer fixtures as site evidence.
4. Add validated union arithmetic/procedure support to the public contract with #10; the current module intentionally returns a draft.
5. Persist/expose the proposal through the production work-package UI/API with #12 and the input lane; demonstrate full selected quantities and delta in numbered sketches, rendered PDF and CSV. This PR does not pretend that exporting a synthetic in-memory snapshot proves that UI flow.
6. Run FS-01 and independently entered MSU FP2.1 through their respective intake flows. No MSU dimensions, Idaho requirements, SF basis or CPVC defaults may be inherited between packages.

Draft PR only; reference #29 without closing it. No merge is part of this task.

## Local verification for this PR

- Workspace `pnpm typecheck`: passed for all six packages/apps.
- `pnpm exec vitest run packages/fabrication/test apps/server/test/integration.test.ts apps/server/test/exports.test.ts`: 82 tests passed (18 closure, 23 existing fabrication, 9 integration, 32 export tests).
- Final fabrication typecheck after product-bound condition input: passed.
- `git diff --check`: passed.
- Browser, rendered closure PDF, CI and physical/practitioner acceptance are separate; not established by these local checks. No frontend code was changed, so no UI build/run is claimed.

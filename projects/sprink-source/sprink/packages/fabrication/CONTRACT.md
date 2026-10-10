# Fabrication v1 handoff and parallel-lane contract

The JSON DTO is `src/types.ts` (`FabricationInput`, `FabricationOutput`). Import pure functions from `@sprink/fabrication` after adding a workspace dependency in the consuming lane. No shared core/API types are changed in this branch.

Generate the JSON examples locally with `pnpm --filter @sprink/fabrication examples` from `sprink`; the generated files are not checked in.

| Handoff | Repository-relative path |
| --- | --- |
| Input/output DTO | `sprink/packages/fabrication/src/types.ts` |
| Drawing input | `sprink/packages/fabrication/examples/drawing-input.json` |
| Drawing output | `sprink/packages/fabrication/examples/drawing-output.json` |
| Selected candidate input | `sprink/packages/fabrication/examples/adaptation-input.json` |
| Selected candidate output | `sprink/packages/fabrication/examples/adaptation-output.json` |
| Baseline/candidate delta | `sprink/packages/fabrication/examples/delta.json` |

## #13 rendering

Read `materials`, `cuts`, `fittings`, `joints`, `subassemblies`, `operations`, and `gaps` from the same output. Pieces have numeric callouts, fittings F-prefixed callouts, and joints their own numbers. Use entity IDs for all cross-highlighting, not row indices. Fittings retain center positions, port IDs, source-entity lineage, and joint IDs. Pipe pieces retain source-segment lineage and both endpoint positions. `joint.orientation` is the direction from the fitting/node outward along that pipe in the declared coordinate frame. It is not an Euler rotation for a mesh.

Never turn `Metric.value: null` into zero. Print reasons, metric unit and basis, proposal role, source drawing approval, catalog provenance, and outstanding assembly conditions. `selectedProducts` preserves original catalog dimensions, units, and published tolerances. `sources` holds source document URLs/revisions/digests; `evidence` describes caller-supplied evidence, including the explicit fixture disclaimer in these examples. No overall ready/approved flag is emitted. An available output and `planned` operation are not construction approval. Declared rounding is currently none; the renderer must declare any display precision while keeping raw JSON intact.

Bind artifacts to `projectId/packageId/planId/inputRevision/configVersion`; reject stale output using `isFresh`. The application owns the single configVersion and must bump it when the catalog/engine/procedure changes. No independently synchronized catalogVersion exists.

## #9 planning and existing core geometry

`toPlanningProduct(spearsCatalog(configVersion))` structurally matches planning's `GenerateInput.product` (inspected in the separate planning worktree). It supplies compatibility plus:

```text
centerToFace = H = 0.060325 m
insertionOrThreadMakeup = H - G = 0.0269875 m
net takeout = H - (H - G) = G = 0.0333375 m
```

This field represents **socket insertion**, not a threaded makeup. Missing H/G or product evidence remains null. This product port establishes documented dimensional compatibility only; it does not establish project suitability or field movement.

`toLocalPlanGeometry(input, catalog)` emits the structural geometry accepted by `core/local-change-geometry.ts`: exact piece IDs, center nodes, ports, diameter facts, and the same H / H-G mapping. Explicit physical pipe ends become tie-in nodes with a documented zero net offset. Actual tie-ins retain supplied offsets. Proposed positions remain `source: model, confirmed: false`; this adapter never upgrades them to site facts. Synthetic adapter evidence IDs `plan:<id>:explicit-frame` and `datum:<node>:physical-end` describe calculation inputs, not photographs. They must not be imported as field evidence into the project evaluator.

The old core evaluator suppresses centerlines whenever another segment fact is missing and rejects proposed facts. This package therefore keeps a small independent unit/axis/length calculation for partial quantities and proposal estimates. It does not copy collision logic. During merge, share a neutral numerical helper if one is published; do not call the existing-project-change evaluator for drawing preparation.

For a generated planning plan, the application adapter must map segment IDs to piece IDs, `comparison.lineage` to `sourceSegmentIds`, node facts to confirmed/proposed values, and fitting port endpoints to stable port IDs. It must explicitly provide product selection, source-drawing revision/approval, ordered run, subassemblies, scope boundaries, evidence records, and assembly conditions. Do not infer physical-end datums from arbitrary tie-ins, or field confirmation from candidate adoption. The final planning-to-package/store adapter is an integration dependency, not implemented here.

## Changes and limits

`compareWorkPackages` accepts outputs from one project/package/config/frame. It carries both revisions, known quantity/length differences, stable piece changes, proposed reuse, and per-source-segment lineage groups. A split becomes `piece_split_or_merge`, not disappearance of the original segment. Do not sum lineage groups because a piece can reference more than one source segment. Unknown cuts produce null length deltas while known counts remain useful. Exact absence of a material row is zero; an existing unresolved row remains null. Piece deltas are proposals, not evidence of physical demolition.

The output omits omitted model entities by definition: the store/intake lane must ensure heads/supports/couplings in the work scope are supplied as `accessories`. This lane does not discover them from a PDF. Unsupported field closures and accessories remain visible; no PDF/CSV renderer, route generator, storage migration, endpoint, or UI is included.

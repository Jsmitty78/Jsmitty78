# Shared fabrication engine

`deriveWorkPackage(input, catalog)` produces materials, per-piece cuts, numbered connections, and an ordered assembly plan for either workflow intent. `compareWorkPackages` adds baseline/candidate material, piece, lineage, joint-count and operation-count deltas. `isFresh` checks project/package/plan identity plus `inputRevision` and the application's single `configVersion`.

This is an independent domain package for [#10](https://github.com/my-name-is-yu/InnovationCup/issues/10). It does not implement an API, candidate generator, UI, persistence, rule coverage, PDF or CSV. No runtime dependencies were added. The lockfile change registers this workspace package only.

## Supported slice

One ordered, connected, nonbranching run of orthogonal straight pieces, with explicitly connected 90-degree elbows. Piece endpoints reference nodes; fitting ports reference exact piece ends. Crossing lines never create a joint. A piece has source-segment lineage and an intended subassembly. Reversing an individual piece's endpoints is allowed when references still reconcile. Branches and invalid connectivity are input errors. Unsupported geometry or products keep their material/cut rows and reasons.

Selected products: Spears FlameGuard CP-010 NPS 1 SDR 13.5 plain-end pipe, 4206-010S NPS 1 sweep socket/socket elbow, and FS-5 solvent cement. See [source dossier](SOURCES.md). This **changes the material selection** from the steel threaded dossier; it does not approve replacing steel in a particular project. The application must explicitly select these products and check project suitability. No hydraulic, listing, support-spacing, or occupancy approval is inferred.

Physical pipe ends are explicit prefabrication boundaries. Their zero offset is a datum definition. `tie_in` endpoints need a scoped confirmed offset for a cut; the first procedure does not support their external closure and retains an unsupported field-joint operation. The positive example is a bounded open-ended spool, not a complete connected sprinkler system. Heads, supports, couplings, and other accessories are retained with counts and references but require their own installation detailing. Cement purchase quantity stays null.

## Calculation and assembly semantics

Values carry `confirmed`, `proposed`, or `unknown` plus evidence/reason. Confirmed values require evidence IDs scoped to the subject (node, plan, accessory, or joint). Proposed geometry can produce estimates but never executable/confirmed facts. Candidate selection and the original drawing's approval are independent output fields. The data loader owns validation against real evidence and drawings; this package does not authenticate a human confirmation.

`cut = centerline - start.netTakeout - end.netTakeout`, in metres without display rounding. The supported elbow uses published `G` as net takeout. `H-G` is full socket insertion, not a guessed thread makeup. Explicit points retain their units/frame. A numerical 1e-10 m equality threshold only absorbs floating-point conversion noise; it is not a construction tolerance. Published dimensional tolerance is catalog metadata, never an added cut allowance.

Missing cuts do not hide known centerlines/counts. Invalid finite values, frames, IDs, or connections throw before producing a misleading package. Aggregate length is null if any constituent is unknown; inspect individual rows for the known portion. Piece counts describe model membership even for proposed plans; use `planRole` and metric basis to interpret them. Counts are installed pieces, not stock lengths or purchase quantities. Reuse is an explicit proposal and always leaves a condition.

The fixed procedure cuts/deburrs each piece, then visits connected joints in piece order. Each socket joint has inspection/dry fit, cement, insertion/rotation/hold, and set/cure steps. Every step points to actual pieces/joints and its predecessor. The user must confirm workspace access, insertion/rotation in this sequence, and a reviewed cure plan covering actual temperature, fit, moisture, pressure, and new-work/cut-in conditions. No movement solver, general DAG, arbitrary sequence editor, torque guess, or stock optimizer exists. Operation counts are not labor estimates. `planned` means a prepared instruction with supplied prerequisites, not performed work or construction approval.

## Run

From `sprink`:

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run packages/fabrication
pnpm --filter @sprink/fabrication typecheck
pnpm --filter @sprink/fabrication examples
```

The command above generates local JSON examples from `examples/fixtures.ts`; generated outputs are not checked in. Their drawing, access, and cure confirmations are invented fixture data. Manufacturer dimensional provenance is real; site validation is not. The separate synthetic arithmetic test replaces dimensions and explicitly labels the catalog `synthetic_arithmetic`.

Independent expectations: the drawing example has 24 in and 18 in centerlines; subtract 1.3125 in from each for cuts of 22.6875 in (576.2625 mm) and 16.6875 in (423.8625 mm). The selected candidate preserves both endpoints and 42 in total centerline, with three pieces and two elbows. Two additional takeouts reduce total pipe cut length by 2.625 in (66.675 mm). Its generated positions remain proposed and movement remains unconfirmed.

## Integration

See [CONTRACT.md](CONTRACT.md) for #3/#9/#13 connection points and concrete DTO/sample paths. The core geometry evaluator in the original checkout was read only. The adapter was smoke-tested against that evaluator with the drawing fixture and returned matching cuts. It is not a dependency of this branch; no uncommitted source was copied. Re-run the adapter check against the eventual merged core/planning versions during integration.

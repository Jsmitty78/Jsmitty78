# Bounded change candidates

Pure candidate generation for [#9](https://github.com/my-name-is-yu/InnovationCup/issues/9), following [design revision 3](https://github.com/my-name-is-yu/InnovationCup/issues/1). This package handles bounded route search; the server integrates it with work-package persistence, evaluation and exports.

## Supported input and output

`generateCandidates(input, geometryPort)` takes an approved/source plan reference with one straight axis-parallel pipe, exactly two fixed tie-in nodes, attached head references, confirmed box ducts, a confirmed work envelope, pipe outside diameter, explicit required pipe clearance, and a product compatibility binding. All IDs are strings; coordinates have an explicit frame and unit (`m`, `mm`, `ft`, `in`). Evidence confirmation is a caller responsibility; model-sourced or unevidenced facts do not satisfy prerequisites.

This first slice **does not accept a prewritten reroute**. It preserves both endpoint positions and the direction of the pipe at the connections. It preserves head and obstacle records. Changing a protected segment is unsupported. Multi-segment runs, interior branches/fittings and pipe-to-pipe interactions are deferred; the integration must extract an eligible span and retain the wider context for shared impact checks. Head-body clearance and support placement are not evaluated.

The search examines at most five templates:

1. The original direct span.
2. A four-elbow detour on each positive/negative perpendicular axis (four templates).

The two lead-in stations are midpoints between the fixed endpoints and the expanded duct range along the span. Each transverse lane is the midpoint of the interval between the duct envelope plus the **supplied** pipe radius/clearance and the work boundary minus pipe radius. This is a deterministic sample of free space, not a construction allowance or an exhaustive search. All ducts contribute to the bounding range, so disconnected or distant ducts can eliminate a template even where another unsampled route exists. Pipe envelopes must fit inside the work box. The shared geometry engine evaluates all segment/duct pairs and cut lengths. Touching a duct is a collision under that engine, including when the explicitly supplied clearance is zero.

The result includes `searchedTemplates`, individual rejected templates with reason codes, accepted provisional plans, geometry calculations, known/unknown deltas, and open conditions. Missing prerequisite geometry yields `input_missing` before search. Missing cut dimensions can still produce provisional routes with null cut metrics and an `input_missing` set state. Invalid connectivity, insufficient dimensions, geometric interference, unsupported geometry, and exhausted search remain distinct diagnostics. Empty results never prove global infeasibility.

Comparison is deterministic: added elbow count, added centerline length, then ASCII template ID. No model ranks or adopts a plan. Changed first segments retain their original ID; additional segments have lineage back to that baseline segment. Retained geometry is not a claim of physical reuse. Fitting-body dimensions, assembly access/movement, field joints, support, hydraulic and rule checks remain explicit unresolved conditions.

## Geometry integration contract

`geometry-port.ts` contains only the minimal structural types needed to accept the existing `evaluateLocalPlanGeometry` function. It does not implement a second geometry engine. The server integration supplies the core evaluator through this port.

Connect the core evaluator:

```ts
const geometryPort = createLocalGeometryPort(evaluateLocalPlanGeometry);
const candidates = generateCandidates(input, geometryPort);
```

The legacy evaluator reads only confirmed facts. The adapter creates a detached **calculation hypothesis** and temporarily makes generated node positions and fitting kinds readable there. The returned candidate retains `confirmed: false` for those proposal values; source facts are never changed. The hypothesis's `verified` result means only that its supported mathematical inputs were sufficient. Do not persist the temporary calculation facts, promote them to observations, or feed their confirmation markers into rule evaluation. A future core calculation API that accepts explicit proposal values can remove this adapter. Known legacy input diagnostics are translated to rejection codes; unexpected exceptions propagate as execution errors.

The shared `configVersion` must identify the deployed generator/templates and geometry/catalog/rule implementations. This package adds no independently synchronized output-version field. Callers must increment `inputRevision` for every semantic input edit. Candidate IDs include project/package/revision/configuration/baseline/template. `selectCandidate` rejects stale or cross-package requests and returns a detached selection proposal. The server must persist the explicit user selection, increment the semantic revision and regenerate derived outputs; this helper does not write state.

## Materials/assembly handoff and remaining scope

`deriveCandidatePackages(input, set, derive)` calls the same typed `DeriveWorkPackage<T>` callback for the baseline and every candidate. It preserves version and plan identity and refuses stale sets. `toFabricationInput` adapts that request to the fabrication lane's current structural DTO, converting coordinates and tie-in offsets explicitly to **mm**, preserving generated positions as `proposed`, carrying split-segment lineage, and retaining heads as unresolved accessory lines. It requires explicit drawing/evidence and assembly-detailing inputs; it invents neither access/movement confirmation nor shop/field placement. Its single subassembly and joint-location parameters are a draft integration contract, not proof of an executable sequence.

The CPVC integration test runs the repository’s `deriveWorkPackage` for the baseline and both generated candidates, then for an explicitly selected candidate at the next revision. For the server workflow and its validation scope, see [scenario integration](../../docs/scenario-integration.md).

The source drawing's approval and the site's observed facts remain outside candidate adoption. A returned plan is a proposal; neither `ready` nor user selection establishes construction approval.

## CPVC socket datum mapping

The fabrication lane supplies Spears CP-010 pipe, 4206-010S sweep elbows and the FS-5 solvent-cement procedure. This adapter is not threaded-only: `socketDatumsToPlanning(H, G)` maps center-to-face **H** and center-to-socket-bottom **G** to legacy `centerToFace = H`, `insertionOrThreadMakeup = H - G`. Therefore the geometry engine's net takeout is `H - (H - G) = G`. Missing or unconfirmed H/G produces null insertion; no nominal-size substitution or fit-up allowance is used.

The fabrication catalog attributes H=2.375 in and G=1.3125 in to the 4206-010S row/G-H diagram on PDF page 2 of [Spears FG90S](https://www.spearsmfg.com/flameguard/027-FG90S-2-0723_0824_web.pdf), and pipe OD=1.315 in to [FlameGuard general dimensions](https://parts.spearsmfg.com/sourcebook/FGTECH_FG-1_T_FGGI_T.pdf). The selected connection method and full socket insertion procedure are supplied by that lane's [FG-3 catalog reference](https://www.spearsmfg.com/flameguard/03-FG-3_0321_web.pdf). This branch consumes that catalog and its source IDs; it did not independently re-review the manufacturer's documents or validate installed engagement. Its published tolerance is not silently added to geometry. The legacy field name `insertionOrThreadMakeup` means **socket insertion** for this binding.

Hand check: H=0.060325 m, G=0.0333375 m, insertion=0.0269875 m. With the fixture's confirmed synthetic tie-in offsets (0.05 m each), four elbows have eight ports, giving takeout `8 × 0.0333375 + 2 × 0.05 = 0.3667 m`. The same two detours therefore have cut totals **12.4333 m** and **12.9333 m**, matching both engines. Site geometry, clearance, tie-in offsets and assembly conditions remain synthetic/unconfirmed as labeled; this is not a source-backed field release example.

## Reproduction and evidence

From `sprink`:

```sh
pnpm install --frozen-lockfile
pnpm --filter @sprink/planning typecheck
pnpm exec vitest run packages/planning
pnpm typecheck
pnpm test
```

Tests import the repository’s core geometry evaluator and fabrication engine directly. All geometry and CPVC integration cases run by default; no external checkout paths or environment switches are needed. Fault-injection tests wrap the same geometry evaluator to exercise missing results and error propagation.

The synthetic fixture in `fixtures/duct.ts` and [its hand calculations](fixtures/README.md) cover two alternatives, one/no candidate, missing geometry and takeouts, protected context, units/frames, unsupported routes, broken connections, negative cuts, axis/reversed routes, direct retention, deterministic comparison, and stale/regenerated selection. The additional CPVC integration consumes the fabrication lane's manufacturer-referenced catalog and obtains draft operations with unresolved assembly conditions. No live service, physical installation, browser flow, or fully confirmed assembly output was verified here.

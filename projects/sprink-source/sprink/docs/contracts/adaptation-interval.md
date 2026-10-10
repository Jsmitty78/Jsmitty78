# Saved-input adaptation boundary (#12)

This slice extends the existing workbench and production work-package APIs. It does not replace drawing intake (#27), site capture (#28), or shared preparation (#11). Create an `adapt_to_site` package directly; no preceding preparation run or supplied reroute is required.

## Input and scope

- `baselinePlan`: saved mm geometry with explicit connectivity, source reference and confirmation state. Arbitrary source PDF/PNG/JPEG intake belongs to #27. The production adapter has no FS-01/MSU IDs or coordinates.
- `changeRequest.affectedEntityIds`: exactly one pipe with two positioned ports and one explicit connection at each endpoint. The selected ID must be included in scope and not excluded. The endpoint entity can be a head, existing fitting, tie-in or other retained context; its identity, positions, ports and outside connections are retained.
- The calculation scope is the active interval, including its generated replacement spans/fittings. All other source entities/connections remain **protected context**, not new purchase quantities. Selecting another eligible interval uses the existing revision-checked edit API; it does not rewrite the baseline.
- Interior context touching the interval, zero length, ambiguous endpoint connections, multiple affected IDs and unsupported frame alignment are explicit blockers. This is not an arbitrary network router. Pipe/fitting-body clearance to protected context, unknown-position context, hydraulic/support/design adequacy remain unresolved; geometry retention is not clearance approval.
- `datum.start/end = scope_interface` from #10 stays a scope station in candidate fabrication inputs. A generated route cannot promote it to a physical end or counted field joint. Original physical tie-ins retain their own independently confirmed offsets; head/fitting stations never borrow offsets.

## Explicit frame and units

With no `adaptationFrame.*` facts, obstacle and work boxes use the saved drawing frame unchanged. A rotated/translated view supplies four global facts in `detailing`:

| Field | Unit | Meaning |
|---|---|---|
| `adaptationFrame.origin.x/y/z` | mm, m, ft or in | Local origin expressed in the saved drawing frame |
| `adaptationFrame.yaw` | deg | Counterclockwise local X rotation about drawing Z |

All four must be confirmed numeric values with provenance. Partial/ambiguous transforms are rejected. Frames share Z-up; arbitrary pitch/roll/reflections and source-pixel calibration belong to future intake work. `drawing = origin + Rz(yaw) * local`. The internal local frame gets a distinct ID. Inverse rotation removes only 1e-8 mm floating-point noise; this is not a field/construction tolerance. Original endpoint coordinates are restored exactly.

`duct.min/max.x/y/z`, `workEnvelope.min/max.x/y/z`, and `requiredPipeClearance` accept mm/m/ft/in and require confirmation before dependent search. Values are expressed in the explicit local frame. The UI projects boxes back through the same transform; it never substitutes a bounding box for a rotated obstacle. Missing height remains missing.

The server's existing `fabricationCatalog(configVersion)` and `toPlanningProduct(catalog, selectedPipeId)` select the product strategy (#31/#10). Unknown products do not fall back to CPVC. No generation/catalog/closure arithmetic is duplicated here.

## Outputs and freshness

Candidates preserve the baseline and restore all outside entities/connections in the original saved view. The browser compares generated alternatives, requires explicit selection, shows full active-interval materials/cuts/assembly and delta, links material/assembly subject buttons to the drawing, and exports through existing revision-bound services. Modeled spans are not final closure/purchase piece counts. Missing cuts are null, not zero.

PDF plan views also retain context under separate C callouts/tables (not J physical joints or purchased pieces). Source/fixture descriptions and unknown conditions remain in the handoff. Current product/closure limitations remain visible. Selection is not approval.

Existing semantic edits invalidate candidates/results/downloads; source/baseline immutability rules remain intact (a new frozen drawing requires a new package). API cancellation/restart/conflict handling is reused. Manual candidate editing and complete shared intake remain pending.

## Parallel integration

This PR is stacked on #31 (`yu/issue-10-steel-catalog`, `d0d604c` at validation). #30/#29 exposes `deriveFixedEndClosure` over the shared fabrication types, with independently bound closure conditions. It is not production-wired here: no closure proposal is silently invented, and fixed-end acceptance remains unresolved. Its two material export-description lines are outside this PR's frame/context additions.

A future closure integration must persist its proposal through the input API, bind it to project/package/plan/revision/product, feed its output to the existing full/delta/export surfaces, and preserve the protected context and unknowns. Practitioner review and physical fit are separate from this software slice.

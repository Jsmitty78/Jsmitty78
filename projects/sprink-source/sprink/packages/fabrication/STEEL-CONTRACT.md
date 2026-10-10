# Steel detailing contract (#10)

Base: `6fc29db`; branch `yu/issue-10-steel-catalog`.

`fabricationCatalog(configVersion)` combines the existing CPVC choices with
`steelCatalog(configVersion)`. `STEEL_PAIRS` exposes NPS 2 and NPS 1 black
Wheatland A53 Schedule 40 pipe / Anvil Fig.351 Class 125 cast-iron elbow identities.
These are internal family/finish/size keys, not verified procurement SKUs.
There is no source-project default selection. Listing limitations, actual end
preparation and project suitability remain review requirements.

Connection method: `steel_threaded`. A fitting port optionally carries
`threadMakeup: { pipeProductId, fittingProductId, axialEngagement: Value<Length> }`.
Engagement is measured from the fitting face to the final pipe end, with evidence
scoped to `fittingId/portId`. Generic arithmetic subtracts
`centerToFace - axialEngagement`. Pair mismatch or missing evidence leaves null
cuts, preserving centerlines/counts. Tightening turns are never an axial datum.
`Node.netCutOffset` remains the explicit tie-in datum interface.

Production saved facts use `threadMakeup.<portId>` with unit and fitting subject;
companion confirmed string facts `threadMakeup.<portId>.pipeProductId` and
`threadMakeup.<portId>.fittingProductId` bind dimensions to products. Per-joint
preparation/sealant/access review uses `threadedJointPlan.<portId>` and the existing
`movement.<portId>`. Review companion fields
`threadedJointPlan.<portId>.pipeProductId` and `.fittingProductId` bind the
plan/movement review separately from the dimensional input. The engine's optional
`assemblyConditions.threadedJointPlan[jointId]` holds that pair, `plan: Value<string>`
and `movement: Value<boolean>`. The model widens those fitting-scoped evidence records only
to the corresponding joint. Changing a pair does not reuse old engagement.

#29 owns fixed-end closure, any added components/splits, and its reviewed sequence.
This contract does not declare fixed-end installation feasible. #12 owns protected
context and generation. Product selection into planning must be explicit; no
absent source product can inherit CPVC or Idaho's steel selection. A generated
joint does not inherit an existing joint's measured engagement.

Acceptance remains partial pending real engagement measurements, project/product
approval, complete positive detailing evidence and practitioner review. Numerical
fixtures use explicit invented dimensions and are not field acceptance.

`Node.datum = "scope_interface"` (saved `datum.start/end`) marks a work-area
station that is neither a physical cut end nor a proven joint. It retains projected
length but yields null cut and unresolved joints/support/stock requirements.
Source-context heads have null purchasing quantity; each row remains one retained
model reference. The production adapter accepts a head boundary only with that
explicit datum. This is independent of #12's adaptation interval extraction.

`toPlanningProduct(catalog, pipeProductId, elbowProductId?)` selects the pair
explicitly; omission works only for a catalog containing exactly one pipe choice.
Steel `insertionOrThreadMakeup` is null because a generated joint has no measured
engagement. #12 may generate geometrically provisional routes, but must preserve
this null through detailing. Per-existing-joint engagement travels through
`toLocalPlanGeometry` with its input basis/evidence, never promoted from proposed.

The production aggregate configuration is `scenario-integration-2-steel`.
San Francisco rules run only with an explicit confirmed SF jurisdiction fact;
source NFPA editions and catalog selection do not create jurisdiction/permit facts.

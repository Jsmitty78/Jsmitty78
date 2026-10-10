# Field validation core

Import from `@sprink/core`. This package has no Pi, network, camera, database, or filesystem dependency. It evaluates supplied facts; it does not infer them from images.

## Adopted head rules

`validateRules(facts: HeadFacts, ctx: RuleContext): RuleResult[]` evaluates ten independent, versioned checks from [TYCO TFP171, August 2026](https://docs.johnsoncontrols.com/tycofire/api/khub/documents/JXGj~rL_f_FBVCY52uMTJw/content). `ADOPTED_RULES` is the immutable source registry. Each definition has an ID, Japanese title, version, scope, and exact source pages. `validateHead` and `RULE` remain aliases for the orientation check, now `TFP171_INSTALL_ORIENTATION_V2` (version 2). There is no combined whole-system compliance result.

| Check | Source pages | Executable boundary |
| --- | --- | --- |
| Installed orientation | 3, 5, 6, 7 | Model-specific upright or pendent; no invented angular tolerance |
| Recessed escutcheon | 3, 4, 6, 7 | TY2231/TY3231: Style 10/20; TY4231: Style 30/40 |
| Bulb condition | 4, 5 | Confirmed cracking or liquid loss fails |
| Installation wrench | 5 | Standard: W-Type 6; recessed: W-Type 7 |
| NPT installation torque | 3, 4 | 1/2-inch: 7–14 ft-lb; 3/4-inch: 10–20 ft-lb, inclusive |
| Retrofit-only models | 1, 3 | NPT TY4831/TY4931: retrofit passes, new construction fails |
| Post-factory finish | 5 | Confirmed field painting/plating/coating fails |
| Sprinkler leakage | 5 | Confirmed leakage fails |
| Visible corrosion | 5 | Confirmed visible corrosion fails |
| Maximum working pressure | 8, Table D | NPT: 175 psi; TY3131/TY3231 may use 250 psi under confirmed UL/C-UL listing basis |

All checks are scoped to independently confirmed installed heads. Standard mounting covers upright TY2131/TY3131/TY4131/TY4831 and pendent TY2231/TY3231/TY4231/TY4931. Recessed mounting covers only TY2231/TY3231/TY4231. Independently confirmed unsupported model/mounting combinations return `not_applicable` with an explicit unsupported-scope reason; that result never approves the installation. Torque, retrofit, and pressure checks require confirmed NPT threads; the source's special ISO 7-1 products are not evaluated by these NPT conditions. The retrofit check implements the manufacturer's notice, not an independently selected NFPA edition or jurisdiction.

These are individual conditions, not a complete product approval. Escutcheon pairing does not verify listing agency, temperature, adjustment range, or fitting-to-ceiling dimensions. Wrench and torque values require evidence of the installation process; they cannot be inferred from the completed appearance. The torque result does not establish a leak-tight joint or instruct a person to retighten an installed head. `bulbCondition: "intact"` means independently checked absence of both cracking and liquid loss. `fieldFinish: "factory_only"` excludes only the listed painting/plating/coating conditions; other physical damage or alteration remains outside this check. `leakage: "absent"` requires a recorded inspection and is not a pressure test; visible-corrosion absence does not establish internal condition.

The pressure input is the independently established **maximum system working pressure**, not one current gauge reading, a catalog rating, or a hydrostatic test pressure. Its `pressureBasis` fact must be confirmed as `system_maximum`; `spot_reading`, `catalog_rating`, `test_pressure`, and missing basis return `unknown`. For TY3131/TY3231, a valid maximum pressure at or below 175 psi satisfies the pressure limit independently of the optional approval basis; above 175 and at or below 250 psi requires confirmed `ul_cul`, with unknown basis remaining `unknown`. Above 250 psi fails either documented allowance. No pressure result establishes listing suitability or hydraulic adequacy.

## Facts and evidence

The five original `HeadFacts` fields remain required: `model`, `installation`, `mounting`, `orientation`, and `verticalReference`. Twelve optional fields add the other checks: `escutcheon`, `bulbCondition`, `installationWrench`, `threadStandard`, `installationTorqueFtLb`, `construction`, `fieldFinish`, `leakage`, `corrosion`, `workingPressurePsi`, `approvalBasis`, and `pressureBasis`. Old five-field records remain valid and produce `unknown` for applicable new checks. `emptyFacts()` initializes all 17 fields without confirmation. `HEAD_FACT_FIELDS`, `FACT_OPTIONS`, and `NUMERIC_FACT_FIELDS` expose the shared field contract for clients.

```ts
interface Fact<T = string> {
  value: T | null;
  confirmed: boolean;
  evidenceIds: string[];
  source: "manual" | "model" | "fixture";
}
```

A `model` source is always a candidate, even if a caller sets `confirmed: true`. A person independently verifying an observation or installation record may record a manual fact with its evidence. A manufacturer's required direction cannot serve as the observed direction. `verticalReference` must independently establish `gravity` or a `verified_record`; image up/down alone does not do that. Lack of a visible problem in an AI candidate is not confirmed absence.

`RuleContext` is `{ targetId, taskRevision, observations: Evidence[] }`. An evidence record is `{ id, targetId, superseded?: boolean }`. Every referenced ID must resolve exactly once, belong to the target, and not be superseded. Observations are immutable: merely advancing the task revision does not invalidate existing evidence. The host supersedes replaced evidence and invalidates result snapshots when their inputs or adopted rule/source versions change.

Independently established exclusions can return `not_applicable` despite unrelated missing facts. Otherwise missing applicability, invalid values, missing evidence, and unconfirmed inputs yield `unknown`. Results retain reasons, missing paths, evidence IDs, source pages, exact task/rule/source versions, and optional `title`/`scope` populated by the current validators.

`comparePlan(planOrientation, facts, ctx)` separately returns `match`, `different`, or `unknown` for direction only. Matching a plan can still fail a manufacturer rule. Fixture facts test rule behavior, not image interpretation or physical installation.

## San Francisco project edition basis

`resolveSfNfpa13Edition(facts: SfProjectFacts, ctx: RuleContext)` is a separate, read-only edition selector from [SFFD Administrative Bulletin 2.04, Fire Sprinkler Submittals (2025), page 1, Notes 1.A–C](https://sf-fire.org/media/4169). `SF_PROJECT_BASIS_SOURCE` pins that published bulletin (not the earlier draft), revision `2025`, checked `2026-09-26`. It is not an eleventh compliance rule, does not modify a task, and never uses today's date or the jurisdiction alone to assign an edition.

The first three facts are `jurisdiction`, `standard`, and `permitKind`. Its supported paths are San Francisco NFPA 13 FIRE Only permits for a **new building under a site-permit schedule**, and FIRE Only revisions/as-builts submitted under a new application number after the original permit was issued. `revision`/`as_built` facts assert that specific original-permit relationship, not an arbitrary drawing revision. Other confirmed jurisdictions, standards (including NFPA 13R/13D), and permit kinds return `not_applicable`.

For the new-building site-permit path, independently confirmed matching `sitePermitCodeCycle` and `architecturalPermitCodeCycle` map `2019 → NFPA 13 2016`, `2022 → 2022`, or `2025 → 2025`. `editionElection` must explicitly choose `permit_basis` or `owner_newer`; the latter also needs independently confirmed `ownerRequestedEdition` of 2022/2025 strictly newer than the base. Mismatched cycles, unsupported editions, and contradictory owner requests remain `unknown`.

Revisions/as-builts require a nonblank `originalFirePermitNumber` and supported `originalNfpa13Edition` from the issued original FIRE Only permit. They retain that edition without needing unrelated site-permit facts. A supplied `owner_newer` election or conflicting requested edition remains `unknown`. No new-edition election is assumed when it is absent. A supplied election/request still requires confirmation and valid evidence.

`SfProjectFactsSchema` is a strict JSON contract: the first three fact properties are required, and six pathway-specific properties are optional; each uses the same `Fact<T>` confirmation/evidence contract. Missing or unsuitable inputs, model-source candidates, and invalid or wrong-target evidence stay `unknown`. The result is `{ status: "resolved" | "unknown" | "not_applicable", nfpa13Edition, reason, missingInputs, sourceRefs, taskRevision, targetId }`. `resolved` identifies this bounded edition basis only; it does not establish permit approval, a complete code basis, or system compliance.

## Measurements

`validateMeasurement(measurement, ctx)` validates acquisition records and returns `{ status: "recorded" | "unknown", qualityRecorded, accuracy: "unknown", valueMeters, reason, missingInputs, targetId, taskRevision }`. A recorded measurement never implies physical accuracy or installation suitability.

All measurements have `{ id, targetId, unit: "m", evidenceIds }` and one of:

- `method: "manual"`, `valueMeters`, `fromLabel`, `toLabel`.
- `method: "ar_raycast" | "fixture"`, `from`, `to`.

Each endpoint is:

```ts
interface MeasurementEndpoint {
  coordinateFrameId: string;
  captureSessionId: string;
  timestamp: number; // monotonic seconds within the capture session
  position: [number, number, number]; // metres in coordinateFrameId
  hit: "existing_plane" | "estimated_plane" | "none" | "fallback" | "fixture";
  tracking: "normal" | "limited" | "unavailable";
  evidenceIds: string[];
}
```

Endpoints must share a session and coordinate frame and have finite positions/timestamps, normal tracking, and valid evidence. AR permits actual existing-plane and estimated-plane raycast results; no-hit results and fixed-distance fallback points are rejected. Fixture coordinates require `hit: "fixture"`. Physical endpoint selection and measurement error require separate real-device evaluation.

## JSON boundary

Exports include `HeadFactsSchema`, `HeadFactsPatchSchema` (strict partial updates), `OrientationSchema`, `EvidenceSchema`, `RuleContextSchema`, `MeasurementEndpointSchema`, `MeasurementSchema`, and `factSchema`. Validate untrusted API input before calling typed functions using `checkSchema(schema, value)`, which returns a boolean. Unknown properties are rejected.

From the workspace root:

```sh
pnpm exec vitest run packages/core/test
pnpm exec tsc --noEmit -p packages/core/tsconfig.json
```

# Independent final cleanup audit

2026-09-27. Integration checkout: `[local checkout path omitted]`.
This audits the current local implementation, not the original cleanup branch alone. This audit preceded publication; it did not perform commits, pushes or merges.

## Responsibilities removed

- Fixed business-operation scheduling (`policy.ts`, `planNext`) and fixed question-order fallback (`fallbackQuestion`).
- Provider-free synthetic production tool calls (`stream.ts`, `decisionStream`, `WORKFLOW_MODEL`).
- Astra transport constrained to an already-selected operation (`llmDecisionStream`); the current transport exposes normal tool choice.
- JEV business-operation ranking outside Pi. JEV is now invoked by the rule-selection tool inside the Pi Agent.
- Region/product preselection of rule packs in the work-package profile. The complete catalog is supplied to JEV; selected scripts still validate applicability.
- Legacy action-response fixture and obsolete demo/smoke entry points, accompanying policy tests and current-design documentation.
- Unused fallback trace fields and old question-order/evidence-candidate/recent-result fields.
- Orphan `JsonRunStore`: after demo removal no caller remained. Deleted its file and public export; no saved user data was deleted.
- Fixture-only disk persistence and staged-evidence state from the deleted demo/old tests. Current tests retain their in-memory domain fixture.

The initial independent patch covered only four non-conflicting files. The runtime changes above were made by integration owners and independently inspected; they are not claimed as edits made solely by cleanup.

## Responsibilities retained and why

- `evaluateProject` bulk entry: currently called by authenticated `POST /api/rules/evaluate`, `scripts/evaluate-project.ts`, and existing evaluator tests. It accepts an explicitly supplied pack list; it is not the new work-package selector or a failure fallback. Removing it would delete a functioning API/CLI.
- Common rule predicates, source/evidence checks and applicability gates: required for both the bulk API and individual catalog execution. Previously duplicated local-change checks now share helpers.
- Fabrication profile without regulatory execution: exposed as `deriveFabricationProfile` for fabrication/source-conflict checks. The new `evaluateProfile` requires a selected rule ID; the former optional rule ID → bulk-evaluator fallback was removed.
- Test-only scripted streams: imported by workflow/server regression tests. Server startup does not pass `testStream`, and the production package does not import test providers.
- Run revision/cancellation/commit protection and existing SQLite-backed work-package persistence: still responsible for authoritative state, human answers and late-result rejection.
- Geometry, drawing/library retrieval, candidate generation, explicit user adoption, authentication and PDF/CSV generation: current product responsibilities, not deletion candidates.
- Historical integration records: labelled as old implementation evidence; not treated as current design or acceptance.

## Findings resolved during integration

- Local-change bulk/individual duplicate formulas: moved to shared check helpers.
- Individual execution discarded `requiredArtifacts`: now returned by individual checks through `executeProjectRule`, and mapped to profile `DELIVERABLE-...` rows with source references.
- Optional `evaluateProfile` legacy fallback: replaced with selected-ID-required evaluation plus explicit fabrication-only entry.
- Orphan JSON store, fixture disk state and obsolete contract fields: removed after ownership coordination.

## Verification and limits

- Fresh search of workflow and server integration found no old policy/stream/forced-action/fallback-trace symbols, `JsonRunStore`, `stagedEvidence`, `evidenceCandidates`, `recentResult` or question-order fields.
- Inspected `new Agent` and one `agent.prompt`; Pi owns the model/tool loop. No separate production scheduler/dispatch loop was found. The outer wrapper handles lifecycle, tool authorization and cancellation.
- After the final cleanup edits: workflow typecheck passed; all 37 tests across 3 files passed; `git diff --check` passed.
- This is a call-site and code audit plus focused regressions. The integration owner is responsible for the ongoing real-provider two-flow/export acceptance. This audit does not claim that acceptance is complete.
- No identified production legacy-control deletion remains outstanding within this audit scope. Retained APIs and test seams have current callers as described above.

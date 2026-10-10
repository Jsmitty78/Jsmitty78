# Historical scenario 2/3 integration record

This records the earlier fixed-policy implementation and its tests. It is not the current execution design or acceptance evidence. See [Pi rule selection](pi-rule-selection-design.md) for the replacement.

The production server now connects the authenticated, revision-bound work-package API to the actual Pi workflow, bounded candidate planner, fabrication engine, rule evaluator and Jake's PDF/CSV exporter. `GET /api/work-packages/:id/detail` exposes the persisted calculation inputs, outputs, required evaluation rows and latest workflow record behind the same bearer authentication.

## Boundaries

The saved structured graph owns connections, units, selected products and facts. Drawing upload does not extract or confirm a model. A caller must supply the structured baseline and explicit detailing facts. Pi schedules deterministic tools; JEV chooses only between permitted workflow actions. Neither chooses an engineering result, approves a candidate or changes a rule pack. Human candidate selection remains explicit.

- `prepare_from_drawing` derives the baseline without inventing a discrepancy or reroute.
- `adapt_to_site` accepts a measured duct and bounded work envelope, generates two supported alternatives in the fixture, and waits for a human selection. It evaluates baseline and candidate packages and retains the delta.
- A completed run means the requested draft outputs were produced. It does not mean every check passes or that installation is approved.
- Unknown cuts stay null, while known quantities and centerline lengths remain available. The rule engine's verified center-to-center datum requirements also gate the integration output.
- An edit or cancellation prevents late workflow publication. Duplicate starts reuse only a matching goal. Artifact access and export creation reject stale revisions.
- Rule packs are selected by the application. Required rows include cut arithmetic, assembly conditions, applicable executable rules, unresolved NFPA domains and scope completeness. Source-pending checks remain visible. Unselected manufacturer/local-change coverage is not presented as an applicable requirement.

## Supported input mapping

`baselinePlan` uses millimetres and explicit port connections. Pipes have two ordered ports (start, end). The adapter currently supports one open run with fitting/tie-in endpoints. It rejects disconnected/closed graphs and candidate routing that would otherwise silently discard protected heads or supports.

`detailing` and `siteFacts` use their saved confirmation state and evidence identity. Multiple matching facts are rejected. Global facts have an empty `subjectIds` list.

| Field | Subject | Unit / value |
| --- | --- | --- |
| `datum.start`, `datum.end` | Pipe ID | `center_to_center` or explicitly open `physical_pipe_end` |
| `netCutOffset` | Tie-in ID | Length with `m`, `mm`, `ft` or `in` |
| `movement.<portId>` | Fitting ID | Confirmed boolean |
| `workAreaAccess` | Global | Confirmed boolean |
| `curePlan` | Global | Reviewed procedure text |
| `duct.min.x/y/z`, `duct.max.x/y/z` | Global | Confirmed millimetres |
| `workEnvelope.min.x/y/z`, `workEnvelope.max.x/y/z` | Global | Confirmed millimetres |
| `requiredPipeClearance` | Global | Confirmed millimetres |

Project-basis and local-change facts are forwarded to the rule evaluator. The current fact adapter carries drawing evidence; it does not manufacture permit-history evidence. Consequently a declared edition alone cannot resolve the project permit basis. Answers can acknowledge unavailable information; only a fact edit confirms an engineering input.

## Reproduce local evidence

From `sprink`:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

The demo starts the real server on an ephemeral loopback port, creates/uploads/edits through HTTP, runs actual Pi and domain engines, selects a candidate, exports and downloads all four artifacts per scenario. It saves the detail records and a summary. Its structured drawing and site confirmations are explicitly invented acceptance fixtures, not field evidence. The integration tests' Choice response is hand-authored test data, not a recorded live service response.

Scenario 2's supported positive fixture is an open-end CPVC spool: two pipe cuts of 0.5762625 m and 0.4238625 m, with supplied access, movement and cure confirmations. Scenario 3 generates two alternatives with total cuts of 12.4333 m and 12.9333 m; selection and exports retain proposed geometry and unresolved closure conditions.

For PDF output, configure `SPRINK_PDF_FONT` to a readable Unicode font if neither supported system fallback is installed. The exporter requires this for the actual evaluator's Unicode text. `TYPESAFE_API_KEY` enables the real JEV HTTP client. Without it, the bounded fallback is explicit; the live smoke command reports a skip and exits nonzero.

## Remaining acceptance work

1. **Fixed-end CPVC closure remains unsupported.** The current pipe/elbow/cement catalog does not establish a closure part, dimensions, insertion/rotation access or installation sequence. An open-spool positive fixture is not fixed-end acceptance. The corresponding operations and evaluation remain unresolved/unsupported.
2. **Live JEV is unverified.** No API key was configured during this integration run. Tests validate actual Pi execution and the Choice wire contract with test data, not remote service availability.
3. **No browser or product acceptance.** This work covers the server/API/export path. Closed UI PR #20 is not restored, and the earlier browser workflow is not claimed complete.
4. **Permit, hydraulic, head/support and source-pending requirements remain explicit.** This is a bounded draft work package, not comprehensive design or construction approval.

The issue references and test counts below describe that historical run only.

## Integration verification (2026-09-27 UTC)

The final local integration run passed 633 tests across 23 files with the external planning geometry/fabrication modules enabled, followed by workspace typecheck and the web build. The loopback HTTP demo downloaded PDF, BOM CSV, cut CSV and manifest for each scenario. The rendered PDF contact sheets were inspected across all 6 Scenario 2 pages and 30 Scenario 3 pages; drawing callouts, tables, unresolved conditions and source references remained within page bounds. Scenario 3 is verbose because unresolved operation conditions remain visible; this is not browser or editorial acceptance. The live JEV smoke command exited 2 with `TYPESAFE_API_KEY` not configured.

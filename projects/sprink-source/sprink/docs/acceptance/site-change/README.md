# Site-change implementation and acceptance — 2026-09-27

Local Sprink/Pi implementation. No new service, agent, account system, sharing or
public deployment. **No new unit tests.** New verification uses browser actions,
real providers, an isolated DB, and assertions on downloaded files. Existing
52 test files / 897 tests passed as regression; typecheck and production web build pass.

## Delivered

- Original PDF/image evidence, page/crop selection, real Pi image-reading proposals,
  overlays, correction/adoption/rejection, and retained original proposals. The
  existing model configuration is unchanged; AI does not confirm facts or adopt routes.
- Human-reviewed straight span, preserved endpoints/heads, explicit product choice,
  structured measurements, unavailable reasons and provenance. Synthetic fixtures
  stay synthetic. Measurement guidance points to reviewed evidence where available;
  otherwise it displays an explicitly unscaled schematic and states the missing mapping.
- Existing route/material generation plus conservative fitting/assembly box-envelope
  checks, plan/XZ comparison, bounded rejection reasons and recovery after edits.
  JEV selects rules and the actual verification programs execute them. Mandatory
  support/assembly/head/hydraulic review topics persist independently of JEV completion.
- Draft PDF with source images, all-candidate comparison table, before/after diagrams, changes, inputs, checks and
  designer records; BOM/cut CSVs and version/hash-bound manifest. Unknown cuts stay blank.
- Version-bound conditional/revise/accepted records, plan snapshots, reviewer/time,
  conditions and four review topics. Old responses are visibly stale after change.
  No free-text response is automatically converted to confirmed dimensions.
- Existing guards handle concurrent saves, interrupted work, stale outputs, and
  source/frame correction. A discovered drawing-tool handoff bug was fixed: the
  drawing remains interactive while a selected measurement tool is active.

## Browser evidence

Paths below are relative to `sprink`; `e2e-out` is intentionally git-ignored.
Input fixtures, independent oracles and repeatable scripts are included in source.
Both final packages passed `verify-reading-oracles.py`: target pipe and both heads
match independent source coordinates, and all 15 original AI-proposed dimensions
match the independently written fixture values.

| Scenario | Evidence/result |
|---|---|
| Fresh real-provider full flow twice | Final v11 draft-export/error-reporting build: `e2e-out/site-acceptance-v11/report.json` **two consecutive fresh passes**. Earlier handoff build passed twice; later runs hit real JEV HTTP 520 and ambiguous-distribution failures on their second flows and are explicitly not consecutive-pair passes |
| Independent geometry | +1.55 / +1.75 m, four elbows per detour, original steel retained; checks in each full-flow report |
| Measurement guide | Reviewed source location rendered through UI; source remains a labelled synthetic sketch |
| Files | Actual browser PDF/CSV/manifest downloads; SHA-256/bytes/revision/plan binding, centerline sum, elbows and unknown-cut CSV checked by `verify-site-artifacts.py` |
| PDF visual review | All 37 pages of the second final v11 revised PDF rendered and inspected as five contact sheets in `e2e-out/site-acceptance-v11/all-pages`; no observed clipping/blank glyphs. Repeated unresolved details remain verbose |
| Rotated/ambiguous source | Real Pi leaves unreadable digits/absent values unknown; human 300 mm correction, field/location editing and original-proposal audit: `site-reading-v11` (real AI read during `site-restart-v11`, human correction through UI) |
| Concurrent edits | Stale second-tab save gets 409, first value persists, unavailable reason survives reload, old results stay stale; `site-state-v11` |
| No routes / unavailable height / edit during run | `site-recovery-v11`: rejection reasons retained, missing height not invented or requested again, late results rejected, corrected inputs regenerate two routes |
| Oversized fitting | Full flows change 100 to 900 mm, detect envelope failure, then recalculate and download revised drafts |
| Designer re-review / duplicate response | `site-review-v11`: revised plan gets a new revise record, older plan/response retained, competing stale response gets 409, exactly one record added |
| Frame correction | `site-frame-v11`: reopening/changing scale drops previous duct/work coordinates, clears adaptation target and preserves historical responses |
| Server restart / provider outage | `site-restart-v11`: real active run interrupted by server restart; facts preserved; injected outbound failure creates no proposal; browser retry succeeds with real Pi |
| JEV-specific outage | `site-jev-failure-v11`: JEV-only failure is visible, no automatic adoption, UI retry calls actual JEV and executes its selected verification |
| Known cut / existing drawing preparation | `catalog-v11`: actual manufacturer CP-010 nominal 15 ft plain-end stock gives 4.572 m. This is nominal catalog geometry, not a site measurement or installed-system approval |
| Synthetic sample boundary | `sample-boundary-v11`: generation stays disabled without physical-end evidence and the reason is visible; the separate real-source catalog case verifies successful preparation |
| Existing Ask | `catalog-v11`: real source search after answering applicable-edition follow-up returns labelled demo citations; `ask-empty` returns no_source without invented citations |
| 390 px | Full-flow review/export/measurement states fit mobile; desktop screenshots retained |

The older `site-change`, `site-final`, `regression`, and intermediate catalog
failure folders are debugging evidence, **not** passing fresh suites. The old
synthetic preparation sample cannot establish physical cut ends. Its expected
socket cuts are not claimed as verified; the source-backed nominal-stock specimen
is a separate preparation regression and never changes the original steel material.

## Limits of the accepted software scope

- Local single-straight-span/duct case only. Synthetic geometry exercises software,
  not actual site feasibility. Public drawing source and manufacturer source are
  separately identified in `fixtures/site-change/README.md`.
- Envelopes are supplied conservative boxes/radii. Product-specific non-box shapes,
  swept tool motion, supports, head discharge and hydraulics require further evidence
  and/or practitioner review. A pass is only a pass of the named bounded calculation.
- Source mapping is not inferred from photos. Unknown heights, physical cut ends,
  thread makeup and unresolved source-backed checks remain unknown.
- Scope/frame changes require remeasurement; the current reviewed baseline cannot
  be silently replaced by another AI reading. Reopen the drawing or create a new package.
- Designer responses are application records, not externally signed approvals.
- Exported alternative comparisons label each candidate/calculation revision; old
  alternative results are historical, never silently treated as current after edits.

## Budget and reproducibility

Recorded metered model usage at completion: **$62.0210**.

The harness currently enforces a cumulative **$70** metered-model ceiling: the previously approved $20 plus
the user's additional $50. The original $8
counter reset bug was fixed: the same event ledger reconstructs cumulative spend
across restarts. In-flight requests can finish above the threshold. JEV billing is
not included in this model-usage estimate; it is not an all-provider invoice.

Run from `sprink`; install the lockfile and Chromium, then run typecheck/build.
Use a local dummy token. Credentials come from existing `.env.local`, never reports.
Keep the SAME `e2e-out/site-change/server` ledger across server restarts.

```sh
E2E_TOKEN=local-test-token E2E_BUDGET_USD=70 pnpm e2e:site:server
E2E_TOKEN=local-test-token E2E_REPEAT=2 E2E_OUT=e2e-out/fresh pnpm e2e:site
E2E_TOKEN=local-test-token pnpm e2e:site:reading
E2E_TOKEN=local-test-token E2E_PACKAGE=<UI-created-package> pnpm e2e:site:state
E2E_TOKEN=local-test-token E2E_PACKAGE=<UI-created-package> pnpm e2e:site:recovery
E2E_TOKEN=local-test-token E2E_PACKAGE=<current-revised-selected-package> pnpm e2e:site:review
E2E_TOKEN=local-test-token E2E_PACKAGE=<confirmed-source-package> pnpm e2e:site:frame
E2E_TOKEN=local-test-token pnpm e2e:catalog
```

Stop the server before `e2e:site:restart`, which owns its server on port 4330 and
uses the same DB/ledger. Supply `E2E_PACKAGE` for a UI-created ambiguous-reading
package and `E2E_BUDGET_USD=70`. For JEV-only failure, start the server with
`E2E_FAILURE_FILE=<absolute-flag-path> E2E_FAILURE_MATCH=api.typesafe.ai`; give the
same flag path plus an unselected synthetic adaptation package to
`e2e:site:jev-failure`. These tests inject failure, never fabricated success.

`E2E_RESUME` / `E2E_STAGE=export` are debugging aids, not fresh-flow acceptance.
Browser scripts mutate only via UI and use APIs solely to read assertions. No
expected routes/results are injected into the DB. Public deployment is out of scope.

## Verification revision

The acceptance run used base commit `d53e787` plus the source hashes in
`evidence.json`. Later main changes to managed rule search and test cleanup were
not part of that run. Screenshots, downloaded outputs and provider traces remain
local in the ignored `e2e-out/` directory; this repository contains their result
summary, input fixtures, independent oracles and rerunnable scripts.

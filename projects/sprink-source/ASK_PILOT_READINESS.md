# Ask Sprink private pilot readiness

Scope: source-backed code/reference lookup only. Base reviewed: `90aca2a5ebaa50ad656db2644b79b2369394744e`. No frontend/voice files changed. No merge to `main`.

**Status: backend hardening is implemented; a real fitter pilot still requires authorized sources, a working TypeSafe/JEV credential, and the deployed smoke test below.** Automated retrieval tests use scripted provider responses, not a live model. No actual standards were scraped, reproduced, or invented for this work.

## Architecture and preserved safety boundary

The current frontend calls authenticated `POST /api/rules/search`. This searches the operator-maintained shared catalog without deciding what applies to a project. Demonstration and project-specific documents are excluded before JEV sees candidates. The older authenticated `POST /api/ask` also handles explicit project context and edition/jurisdiction follow-ups.

Both routes validate the question, read registered SQLite passages, use JEV for selection, expand stored source context, and construct quotations or source pointers. There is no generic answer-generating LLM or keyword fallback. JEV must pass both its independent answer-existence check and each passage's support check (`> 0.5`); those thresholds were preserved. Failed or malformed service responses never produce partial answers.

Citations retain the document, edition, printed section, available pages, display rights and demonstration provenance. Reference search preserves multiple editions and conflicting evidence; project applicability is explicitly unknown. Conflict detection uses operator-reviewed notes with topic/position metadata, not an automatic legal or code authority resolver. Unannotated disagreements remain visible as separate source passages, but are not guaranteed to receive a conflict flag.

## Bugs discovered

Severity: P0 blocks the pilot or risks dangerous incorrect behavior; P1 should be fixed before the pilot; P2 can wait. The following fixes are included.

| Severity | Affected code | Reproduction and root cause | Fix | Regression |
|---|---|---|---|---|
| P0 | `sources/ask.ts` citations/exception checks, `sources/router.ts`, `uploads/router.ts` | Import an excerpt/reference-only document with an interpretation note containing restricted text. Ask and passage views returned the full note; exception conditions and conflict positions could repeat it. A caller could also open an uploaded reference's original, page, preview, review text or OCR observations directly. Those aliases did not check source display rights. | Suppress restricted notes and condition details, redact restricted conflict labels/positions, and require explicit full-display authorization on all legacy upload content routes. Check rights again after asynchronous reads. Unreviewed references remain accessible to operator services, not public upload viewers. | `source-safety.test.ts`: both display modes; `pilot-persistence.test.ts`: every upload alias returns `display_limited`, while permitted originals still work. |
| P0 | `sources/store.ts`, `sources/demo.ts`, `sources/ask.ts`, `uploads/service.ts` | A known demonstration document could be copied/imported under a new id with `demonstration:false`; re-indexing could replace a demonstrated upload without preserving provenance. Citations already retained the flag, but excluded documents and individual claims did not. JEV mixed demonstration and authentic candidates in project search. | Reject relabeling of reserved demo markers, bundled demo packages and already-known demo content hashes; keep demonstration status through replacement. Separate project-search batches by provenance. Add answer/claim/excluded flags, a visible demo summary and original-file banner, and demo headers on binary source responses. Shared search continues excluding all demos. | `source-safety.test.ts`: all bundled document types, claims, exclusions, inspection, downloads, relabeling; `semantic.test.ts`: provider provenance; `pilot-persistence.test.ts`: failed demo demotion preserves original. |
| P1 | `sources/retrieve.ts:expand`, `sources/pdf-excerpts.ts` consumers | Select a passage that references a second passage which references a third, or select a reviewed PDF excerpt. Expansion iterated a snapshot once; later references and amendment exceptions were omitted. Excerpt candidates had no stored parent link. | Traverse additions until all reachable stored context is expanded, deduplicating cycles. Restore the excerpt's stored parent and its qualifications. | `source-safety.test.ts`: chained/cyclic references, nested exceptions and footnotes, PDF excerpt parent context. |
| P1 | `sources/retrieve.ts:expand`, `sources/ask.ts:applicability` | Two standards share a section identifier, or an amendment targets another edition. Expansion compared the printed section number without matching standard/edition, and project amendment applicability omitted the standard check. | Match standard, target edition and demonstration provenance before attaching amendments; enforce project standard filtering. Shared reference search still expands within each document, never assuming a local amendment applies universally. | `source-safety.test.ts`: matching amendment and exception retained, other standard/edition/demo excluded; existing `rules-search.test.ts`: unrelated jurisdiction stays out. |
| P1 | `sources/ask.ts:searchRules` | Retrieve two sources with reviewed conflicting positions, or a requirement with an exception. Shared search returned `conflicts:[]` and `exceptions:[]` despite available metadata. | Return unresolved conflicts and exception pointers, explicitly retain unknown project jurisdiction/edition/applicability, and warn in the summary when reviewed conflicts exist. | `source-safety.test.ts`: conflicting editions, unchanged governing context, exception parent and unknown applicability. |
| P1 | `sources/store.ts:import` and stored reads | Re-import the same id/bytes with different authorization, edition or scope. The old no-op silently ignored metadata changes. Missing scope/invalid product metadata could also pass ingestion and later crash. Damaged stored ids/counts/JSON were not validated at retrieval. | Reject changed metadata under the same id, validate scope/types, check stored identity/hash/count/section consistency and return a safe `source_unavailable` error. Reject answers when source metadata changes during retrieval. | `source-safety.test.ts`: metadata conflict, malformed scope, damaged rows/counts/JSON and authorization-change race. |
| P1 | `uploads/service.ts:index` | Index a valid source, then attempt a revision with invalid authorization. The prior source was deleted before validation and was not restored. | Transactional removal/import/region preparation; any failure rolls back to the previous indexed source. | `pilot-persistence.test.ts`: failed import preserves the previous source exactly. |
| P1 | `sources/semantic.ts:JevSourceSearch` | A slow multi-batch search could consume many consecutive 30-second windows; concurrent callers multiplied provider concurrency. HTTP bodies had no size bound, and timeout/invalid JSON/connection failures were conflated. | Whole-search and per-batch deadlines, shared batch concurrency/admission limits, cancellation of siblings, bounded response bodies, stable sanitized failure codes and no partial evidence. Preserve the existing evidence thresholds and payload budgets. | `ask-resilience.test.ts` and `semantic.test.ts`: credentials, timeout, stalled body, connection errors, 4xx/5xx, malformed/incomplete results, invalid probabilities, partial failure, oversized inputs, concurrency and retry recovery. |
| P1 | `sources/router.ts`, `sources/ask.ts`, `api.ts` | Send malformed optional context such as `measurements:{}` or `answers:{jurisdiction:{}}`; it could cause a 500 or silently ignore invalid fields. Question endpoints accepted the general 21 MiB JSON allowance. Authentication lacked a stable code; empty-library and no-support results were indistinguishable. | Validate request structure before context lookups, limit question bodies to 32 KiB, preserve the 1,000-character question limit, reject invalid/overflowing measurements, and add additive machine-readable result/error codes. | `ask-resilience.test.ts`: empty/whitespace/long/wrong-type questions, JSON, oversized bodies, optional context, missing/wrong token, empty library and no supporting source. |
| P1 | `index.ts`, new `config.ts`, `scripts/import-sources.ts` | Starting Ask without `OPENAI_API_KEY` failed before listening although Ask only uses JEV. A production process could use checkout-local or relative storage and silently start a new database after deployment. A missing token generated a local token even on remote binding. | Make OpenAI optional for Ask, validate host/port/token/storage, require explicit strong tokens for remote binding, and require an initialized absolute persistent database in production. Production uses environment secrets only. Drain HTTP requests before closing SQLite. Existing explicit `SPRINK_HOST` binding already worked and was retained. | `pilot-persistence.test.ts`: configuration, missing mount, token persistence/rotation, database/assets restart; real `pnpm start` process smoke in development and two production starts. |
| P2 | `sources/ask.ts` summary; operational endpoints/CI | A directly selected amendment could report zero documents. Health was only an authenticated rule-related route, and the repository had no Actions checks. | Count all cited documents, add public minimal `GET /health`, and add the four required CI commands. | Existing amendment Ask regression; `ask-resilience.test.ts`: minimal health/auth; `.github/workflows/sprink-ci.yml`. |

Source paths above are under `sprink/apps/server/src/`; test paths are under `sprink/apps/server/test/`.

Existing extraction tests now call the operator review service directly because unreviewed reference content is no longer publicly displayable. Their extraction/OCR assertions remain intact. The shared-catalog fixture now gives its demo document distinct, explicitly labelled test text so it does not deliberately collide with an authentic-labelled fixture's content hash.

## Verification

All application commands run from `sprink/` unless stated otherwise. The dependency lockfile was not changed.

### Baseline before code changes

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Initial machine-default pnpm 11.25.0 attempt hit sandbox DNS restrictions. Environment/bootstrap failure, not an application failure. |
| `npx --yes pnpm@10.17.1 install --frozen-lockfile` | Passed with network permission using the repository's pinned pnpm. Native dependency builds completed. |
| `pnpm typecheck` | Passed with pnpm 10.17.1, Node 26.5.0 (within repository's `>=22.19.0` range). |
| `pnpm test` | Passed: 23 files, 223 tests, 12.10 s. |
| `pnpm build` | Passed. Pre-existing Vite warning about chunks above 500 kB. |

An attempted `npx --offline pnpm@10.17.1` wrapper could not resolve cached npm metadata (`ENOTCACHED`); checks were rerun with the installed pnpm binary on PATH. No pre-existing application test/typecheck/build failure was found. A final sandbox install refused a package-store switch without a TTY; the exact frozen install passed using the original approved store. A sandbox `pnpm exec tsx scripts/benchmark-ask.ts` attempt hit the tsx IPC-listen restriction; `pnpm exec node --import tsx scripts/benchmark-ask.ts` passed without opening an IPC listener. Neither is an application defect.

### Final verification

Node 22.19.0 and pnpm 10.17.1 are used for the final suite and CI. Local runtime setup used `npx --yes --package=node@22.19.0 node --version` and `pnpm --filter @sprink/server rebuild better-sqlite3` to replace the native SQLite binary previously built for Node 26.

Final command results are recorded below after the last code change:

| Command | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Passed, lockfile unchanged, using the same approved package store as baseline. |
| `pnpm typecheck` | Passed on Node 22.19.0. |
| `pnpm test` | Passed: 26 files, 303 tests, 13.34 s (80 added tests). |
| `pnpm build` | Passed in 1.79 s; only the existing large-chunk warning. |
| `pnpm exec vitest run apps/server/test/ask.test.ts apps/server/test/rules-search.test.ts apps/server/test/semantic.test.ts apps/server/test/source-safety.test.ts apps/server/test/ask-resilience.test.ts apps/server/test/pilot-persistence.test.ts apps/server/test/source-pdf.test.ts` | Passed independently: 7 files, 106 tests, 4.53 s. |
| `pnpm exec node --import tsx scripts/benchmark-ask.ts` | Passed; scripted transport only, figures below. |
| `node /private/tmp/sprink-startup-smoke.mjs` | Passed: starts real `pnpm start`, checks health/auth/empty-library responses, then gracefully stops; repeats twice with `NODE_ENV=production`, initialized persistent storage and explicit `0.0.0.0` binding. Uses synthetic temporary data and no provider credentials. |
| `git diff --check` (repository root) | Passed. |

The temporary process smoke harness checks actual HTTP listeners and restart behavior; persistent source text, SQLite state, assets, generated tokens and explicit tokens are additionally covered by committed automated tests. No provider key names appeared in the web source/build output scan.

`TYPESAFE_API_KEY` and `OPENAI_API_KEY` were absent, and this fresh checkout has no `.env.local`. **A live JEV integration smoke was not performed.** Provider tests are mocked/scripted; real SQLite, decoding, PDF rendering, OCR and local HTTP startup are exercised where stated. The build's existing chunk-size warning remains.

### Performance and bounds

Local Node 22 benchmark, five API requests per case, scripted JEV (no network latency):

| Passages | Median API time | Maximum | JEV calls/request | Largest JEV request | API response |
|---|---:|---:|---:|---:|---:|
| 1 | 0.9 ms | 10.6 ms | 1 | 1,382 bytes | 1,631 bytes |
| 50 | 4.1 ms | 5.0 ms | 1 | 35,955 bytes | 37,687 bytes |
| 600 | 53.0 ms | 53.3 ms | 8 | 59,993 bytes | 446,545 bytes |

No accidental duplicate provider call was found in single-batch requests. The 600-passage case legitimately spans eight bounded batches. Repeated questions intentionally search again; no cache or stale-evidence shortcut was added. These figures are not predictions of live JEV latency.

- Question: at most 1,000 characters; JSON request at most 32 KiB.
- Search: 45 s total, including queued batches and body reads; 30 s per batch. Up to four simultaneous batches across the server's shared search instance and eight admitted searches; excess requests fail safely with `source_search_busy`.
- The existing 60,000-byte serialized request budget, 30,000-byte state-plus-largest-question budget, and 255 candidates/batch remain conservative UTF-8 bounds.
- Whole library selection refuses more than 8,192 candidates or 8 MB of serialized text/table candidates; provider response bodies are limited to 1 MiB. Large clauses are rejected intact, never truncated into a misleading answer. Capacity failures require operator action to section/scope the library; there is no silent candidate dropping.
- Expanded results can still be substantial. Use an appropriately scoped pilot library and verify actual host memory/latency with the authorized corpus. No major indexing or optimization rewrite was attempted.

### API result/error codes

Responses preserve the existing `status`/answer shape and add `code` and demonstration fields. Error bodies contain only safe `error` and `code` values. Provider bodies, keys, prompts, environment values, stack traces and disk paths are not returned.

| HTTP | Code | Meaning |
|---|---|---|
| 200 | `supported_sources` | Stored supporting passages available; this does not certify project applicability. |
| 200 | `context_required` | Project context/follow-up needed. |
| 200 | `empty_library` | No eligible sources; no JEV call made. |
| 200 | `no_supporting_source` | Eligible library exists but no supporting passage was selected. |
| 400 / 413 | `invalid_question` | Invalid question/context or oversized request. |
| 400 | `invalid_json` | Malformed JSON. |
| 401 | `authentication_required` | Missing or wrong token. |
| 403 | `display_limited` | This route would exceed the source's display permission. |
| 503 | `source_search_not_configured` | JEV credential missing. |
| 503 | `source_search_transport_failed`, `source_search_http_<status>` | Connection or provider HTTP failure; no answer fallback. |
| 504 | `source_search_timeout` | Whole-search or batch deadline exceeded. |
| 503 | `source_search_invalid_response` | Invalid, incomplete or oversized provider output. |
| 503 | `source_search_busy`, `source_search_capacity` | Admission or corpus bound reached. |
| 422 | `source_section_too_large` | An intact clause exceeds the provider input budget. |
| 404 / 503 | `source_unavailable` | Missing source asset, inconsistent stored data or source changed while reading. |
| 500 | `internal_error` | Unexpected backend failure; no internal exception details. |

Existing `not_found` codes still identify unknown document/passage ids and invalid page numbers. Operator imports also return typed validation/conflict errors, including `demonstration_required` and `document_metadata_conflict`.

## Deployment requirements

Use one Node process/replica, Node 22.19.0 (CI version) or a compatible supported version satisfying the repository engine, pnpm 10.17.1, and a writable local persistent filesystem suitable for SQLite WAL. Keep runtime dependencies including `tsx`; `pnpm build` builds the web client, and `pnpm start` runs server TypeScript. Native SQLite/image dependencies require a supported host architecture or normal native build prerequisites. No migration to a different database is included.

| Variable | Requirement |
|---|---|
| `NODE_ENV` | Set `production` for hosted pilot validation and environment-only secrets. |
| `SPRINK_HOST` | Defaults to `127.0.0.1`. Explicitly use `0.0.0.0` for a container/remote listener, or retain localhost behind a same-host reverse proxy. |
| `PORT` | Integer 1–65535; default 4310. |
| `SPRINK_TOKEN` | Required in production or for any remote binding: at least 32 characters; use a randomly generated secret. One shared private-pilot bearer token. Development localhost may persist a generated token. Rotate by changing the environment secret and restarting. |
| `SPRINK_DATA_DIR` | Required in production; absolute mounted path containing initialized `field.sqlite`. Server refuses absent/relative/uninitialized production storage instead of creating an unrelated empty library. The import CLI also rejects relative/blank values. |
| `TYPESAFE_API_KEY` | Required for nonempty Ask searches. Server-side only. Missing key yields an explicit error; health and empty-library responses still work. |
| `OPENAI_API_KEY` | Optional for Ask. Only needed for unrelated existing workflow features using the configured model. Server-side only. |

In development only, `sprink/.env.local` supplies provider credentials and overrides inherited provider keys. Host/port/token/storage settings come from the process environment. Production ignores `.env.local`. Never prefix credentials with `VITE_`, put them in the web bundle, commit them, or place the bearer token in a URL.

Persist the **entire `SPRINK_DATA_DIR`** across restarts and deployments: `field.sqlite`, SQLite WAL/SHM sidecars while running, `access-token` for generated-token development installs, uploaded originals/extractions/page images under `uploads/`, prepared source PDF originals/images under `source-pdfs/`, and any existing assets/work-package assets/cache directories. Use consistent SQLite backups or stop the process before copying its database and assets. Keep the same absolute mount location; some legacy asset records use absolute paths. Do not run multiple independent replicas against a shared network filesystem SQLite database.

Typical host setup, from `sprink/` (secret values supplied by the host's secret manager):

```sh
pnpm install --frozen-lockfile
pnpm build
export SPRINK_DATA_DIR=/srv/sprink-data
# Mount/create this persistent directory first, then initialize with authorized packages:
pnpm sources:import /operator-sources/approved-reference.source.json
export NODE_ENV=production
export SPRINK_HOST=0.0.0.0
export PORT=4310
# SPRINK_TOKEN and TYPESAFE_API_KEY must already be supplied securely.
pnpm start
```

Serve the built frontend and authenticated API from the same origin behind HTTPS. Configure proxy request/idle timeout above 45 s (for example 60 s), body limits consistent with the API, and a termination grace period above 50 s. Use `GET /health` for liveness only; its entire JSON body is `{"ok":true}`. It does not prove source readiness or provider availability. The bearer token is the private pilot boundary, not team/enterprise authentication.

CI: `.github/workflows/sprink-ci.yml` runs frozen install, typecheck, tests and build for PRs affecting `sprink/**` or the workflow, and pushes to `main`. It uses Node 22.19.0, pnpm 10.17.1, a lockfile-keyed dependency cache, read-only repository permissions, and fails on any failed command. No deployment automation was added.

## Source library requirements

A real pilot needs operator-supplied material with explicit permission to store/index it, send it to JEV, and display it in the chosen manner. A standards subscription alone is not assumed to grant these rights. Nothing is fetched from the internet automatically.

Source packages contain truthful title, publisher, type, edition, scope, authorization basis, `demonstration` status and an associated text file. Prepared text needs meaningful section headings, faithful wording and page markers. Review OCR and tables against the original. Include exceptions, referenced sections and the applicable local amendments; preserve jurisdiction, target edition, standard and manufacturer product identifiers. Keep revised editions under separate ids. Where originals/pages are used, prepare and persist the matching assets and reviewed PDF excerpt boundaries using the existing operator tools. Do not rely on an excerpt stripped of surrounding qualifications.

Use `display: full`, `excerpt` with a positive `maxQuoteChars`, or `reference_only` according to authorization. Restricted sources do not gain full-text rights through interpretation notes, images or upload endpoints. Exact source inspection must have an authorized stored original/page or a usable original URL.

**Everything under `sprink/demo-sources/` is invented test data.** Its NFPA/manufacturer/jurisdiction-like wording and numbers are not authentic requirements. The demo importer remains for testing. Shared `/api/rules/search` and `/api/sources` exclude demonstration and project-specific material; importing only demo sources therefore leaves the shared pilot library empty. Legacy project Ask can return clearly marked demonstration results, which must never be used for field decisions.

## Remaining blockers

1. Supply and independently review actual authorized sources for the pilot's questions, including the fitter's edition/jurisdiction/product context. This checkout contains no prepared production library.
2. Supply a valid JEV/TypeSafe key and perform a bounded live retrieval smoke with authorized text. Network/provider behavior and live answer quality were not validated with credentials here.
3. Complete the actual host deployment, mount/backup configuration and HTTPS setup; then run the checklist below. No production environment was deployed by this change.
4. The other agent's frontend work must display source scope, demo status, exceptions/conflicts and useful failure states from these API fields. No files under `apps/web/src/workbench/ask/*` were edited. The current simple reference UI may not display every returned warning; inspect this before handoff.
5. This is reference assistance, not an automatic authority resolver. Conflict notes depend on reviewed metadata; arbitrary prose contradictions or unresolved references are not guaranteed to be classified automatically. Review the prepared corpus and source wording with the professional fitter.

The existing large frontend bundle warning is P2. Large-corpus live latency and hosting memory must be measured with the actual corpus; local scripted timing is not a substitute.

## Monday smoke test

- [ ] Open the HTTPS URL on the fitter's device. `/health` returns only `{"ok":true}`. Missing/wrong tokens fail on Ask and all source URLs.
- [ ] Verify the shared library contains only reviewed, authorized real sources with the expected editions, jurisdictions and products; no demo content.
- [ ] Ask one known supported question. Compare every displayed claim with the cited original, printed section, edition and page. Follow the source link on the actual device.
- [ ] Ask a similar but unsupported question. Confirm a no-support result rather than an invented rule.
- [ ] Check an exception/reference chain, two editions, an explicit reviewed conflict and a local amendment. Confirm context and uncertainty stay visible and no authority is silently selected.
- [ ] Open excerpt/reference-only examples. Direct original/page/preview/review URLs must not bypass their restrictions.
- [ ] In a controlled test, remove the JEV credential or block outbound connectivity; confirm a useful safe error and successful retry after restoration. Do not expose secrets while testing.
- [ ] Submit empty/long questions and two concurrent/repeated questions. Confirm no crash, cross-question evidence or duplicate unexplained answer.
- [ ] Restart/redeploy with the same storage mount and token. Verify the same library, original assets and access behavior remain. A missing mount must fail startup.
- [ ] Have the professional fitter review the supported and unsupported examples before sharing the pilot URL further.

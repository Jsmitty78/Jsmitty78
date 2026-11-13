[Profile](../README.md) · [Engineering review](ENGINEERING_REVIEW.md)

# Run the public checks

The profile repository contains a Sprink source snapshot and a separate, small test harness. You can exercise the published frontend without restoring private reference documents, the omitted drawing dataset, or API credentials.

## One checkout, one check command

Use Node.js **22.19.0 or later** and npm:

```sh
git clone https://github.com/Jsmitty78/Jsmitty78.git
cd Jsmitty78
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

Run these commands from the repository root, not the archived `sprink/` workspace. Dependencies are pinned in `package-lock.json`. The root [GitHub Actions workflow](../.github/workflows/portfolio-checks.yml) runs the same command on Node 22.19.0.

## What runs

| Check | Scope |
| :--- | :--- |
| `npm run check:links` | Local link and image targets in maintained portfolio Markdown. Excludes external URLs, heading fragments, and archived upstream documentation. |
| `npm run check:snapshot` | Git blob hashes for all 306 files recorded in the source manifest. Uses the recorded local hash for the historical path-redacted file. |
| `npm test` | Five existing frontend test files, 38 tests. Runs the archived source directly, with no replacement application modules or drawing dataset. |

| Existing test file | Tests | Behavior covered |
| :--- | ---: | :--- |
| `ask/AskPanel.test.ts` | 15 | Typed and reviewed voice entry, duplicate submission, source display, conflicting/empty results, failure recovery, cleanup |
| `ask/speech.test.ts` | 12 | Recognition capability, error states, repeated/interim results, Stop, Cancel, disposal |
| `ask/askErrors.test.ts` | 4 | Authentication, timeout, network/provider error messages |
| `locale.test.ts` | 4 | Locale selection and translation fallback |
| `workflows.test.ts` | 3 | Revision-aware copy and selection behavior |

Paths above are relative to `projects/sprink-source/sprink/apps/web/src/workbench/`.

The original tests use simulated speech recognition and mocked fetch responses. No microphone, model service, or private reference library is needed. This configuration was added for portfolio review in November 2026; it does not change the archived application source.

## Verified locally, 13 November 2026

| Repository / inspected revision | Result |
| :--- | :--- |
| Sprink snapshot at `7efa012` | **38 tests passed**; **306 archived file hashes matched**. |
| [MemoryPath](https://github.com/Jsmitty78/MemoryPath) at `93a1a1a` | **58 tests passed**; TypeScript, lint, and production build passed. Build emitted a Next.js ESLint-plugin configuration warning. |
| [Pathway](https://github.com/Jsmitty78/Pathway-Oxford1stPlaceHackathon) at `9040ac2` | **27 tests passed**; `npm run check` passed. |

Local checks used Node 26.5.0 and npm 11.17.0. The repository workflows provide the separate Node 22/20 checks. Counts here are dated observations; consult the linked workflow runs for the current status.

## Boundaries

- **Sprink:** this is a frontend subset, not a full app build, backend test run, type check, or field validation. Full-app imports still require the omitted drawing dataset. Backend, drawing, geometry, PDF, upload, and end-to-end scenarios are outside this harness. The archived nested CI file is historical; only the root workflow runs here.
- **MemoryPath:** model/realtime calls in automated tests are simulated. Passing tests and a build do not validate clinical outputs, real-user access control, or concurrent approvals in production.
- **Pathway:** the tests exercise a reconstructed JavaScript engine and synthetic scenarios, not measured fall-detection accuracy on people. They do not validate the camera pipeline or send real emergency messages.
- **PBL4:** the case study links the team's code, photos, presentation, and packaging verification. No new projector hardware test was performed during this review.

Snapshot integrity establishes which files were tested, not who authored them or whether the whole system is correct.

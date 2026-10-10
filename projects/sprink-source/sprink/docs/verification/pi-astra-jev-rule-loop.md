# Pi / Astra / JEV verification — 2026-09-27

Verification was performed locally in worktree `71bf` before publication. Subsequent PR publication is separately authorized; merge and deployment are out of scope.

## Verdict

The standard Pi `Agent` now runs GPT-6 Astra with ordinary model-selected tools. Live Astra → live JEV → selected script → detailed result → changed next action was observed for both product flows. Human questions/answers and adoption remained saved application actions. Test engineering inputs and simulated human answers/adoption were explicitly synthetic, not field acceptance.

- Drawing: JEV selected `N01_SF_EDITION_BASIS`; the script returned unresolved permit evidence. Astra inspected saved information, asked a concrete question, resumed after an unavailable answer and exported PDF, BOM CSV, cut CSV and manifest. Unknown access, evidence and catalog limitations remained visible.
- Site change: JEV selected `LOCAL_CHANGE_STRAIGHT_PIPE_DUCT_ENVELOPE_V1` and later `SFFD_LOCAL_CHANGE_SCOPE_V1`. Astra read missing impact-neighborhood/evidence results, researched and asked for field-survey evidence. After the simulated unavailable response it calculated/verified/compared alternatives and asked for human adoption. The adopted plan survived restart at the new revision, and all four export artifacts were produced.
- The latest site flow comprised four runs: waiting for evidence (revision 2), waiting for adoption (revision 3), completed selected package (revision 4), completed export (revision 4).
- Authenticated local workbench displayed persisted materials/cuts, unknown inputs and Astra's saved explanation. This was a focused inspection, not a comprehensive browser acceptance suite.

## JEV size and behavior

All 47 catalog entries plus information-needed and selection-complete options were sent every time. No jurisdiction/product shortlist or character truncation was used. Initial 97,272-byte request failed with `max_tokens_exceeded`. The projection removes duplicated reports and calculation geometry from selection context while keeping candidate descriptions/applicability, required inputs, sources/clauses, facts/unknowns, saved answers and prior outcomes. Detailed geometry and full reports remain available to Astra and the script.

Successful final drawing requests used 8,510–8,692 input tokens. Seven successful site requests used 9,783–20,079 input tokens. JEV returned the relevant duct-envelope rule with confidence 0.71, 0.86 and 0.83 in those site runs, and also returned information-needed when evidence was inadequate. Earlier drawing runs repeated unchanged rules; the application now returns their saved result rather than rerunning them. These observations establish working transport and result-driven behavior, not statistical selection accuracy or coverage.

The live service returned hundredth-rounded probabilities summing to 0.99 across 49 options. Validation accepts only a mathematically possible rounding discrepancy, retaining raw values, exact candidate membership, current revision/model checks and unique argmax. Finer precision and impossible distributions remain rejected.

References: [Choice options and descriptions](https://docs.typesafe.ai/primitives/choice), [JEV token limits](https://docs.typesafe.ai/models), [Responses tool-result continuation](https://developers.openai.com/api/docs/guides/function-calling).

## Verification and limits

- Workspace regression: 866 tests passed across 47 files, including the selected-basis display regression.
- Workspace typecheck and web production build passed. Vite reports the existing large-bundle warning.
- PDF/CSV/manifest were inspected. Latest drawing output was 13 pages and site output 36 pages; all pages were rendered and visually reviewed. No clipping/overflow was observed. Unresolved assembly conditions make the site report verbose.
- Inspection caught a selected edition-basis result missing from PDF findings; the profile projection was repaired and its final rendering checked separately from saved synthetic inputs, without additional paid calls. The corrected finding includes unknown status, the missing permit evidence type and source.
- Source retrieval reads saved structured drawing/intake data and registered source text. It does not newly interpret an unregistered raw raster drawing. The current fact adapter marks evidence as drawing evidence, so permit-record provenance cannot yet resolve through this intake path. Broader NFPA checks still need sources/implementation; fixed-end CPVC closure, hydraulics and physical-device/field acceptance remain unresolved.
- Completion means the requested review artifacts exist. Neither an all-pass subset nor JEV selection completion establishes regulatory completeness or construction approval.

## Cleanup and reproduction

At the user's explicit request, generated PDFs/CSVs/manifests, rendered images, communication traces, temporary logs and test databases are deleted after assessment. Only code, reproducible tests, this concise verdict and the cleanup audit are retained. Original user drawings, product references, fixtures and other worktrees are untouched.

Run `pnpm exec tsx scripts/verify-live-rule-loop.ts` from `sprink` with local credentials to repeat live calls. The harness uses a dedicated temporary directory and cleans it on success, failure and handled interruption. The no-paid cleanup self-check passed all four cases: success, failure, SIGINT and SIGTERM, with zero retained outputs. It prints a compact result; it does not retain artifacts or detailed traces. The project-local `.env.local` remains ignored and credentials are never printed.

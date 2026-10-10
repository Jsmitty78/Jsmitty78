# Sprink: original application source

This is a curated source snapshot of the Sprink team project built for the Recruit Holdings / Indeed Innovation Cup in San Francisco. Jake Smith and Yu Yoshimuta developed the project together; commit history also records AI-assisted contributions. This snapshot includes later mobile, voice-entry and pilot-readiness improvements. It is not presented as the exact 48-hour competition submission.

Upstream repository: `my-name-is-yu/InnovationCup`  
Source commit: `7efa012b2e15f433aa39bba0fcbafeac04399d9f`  
Snapshot prepared: 2026-10-10

## Read the code

- [React interface and mobile Ask flow](sprink/apps/web/src/workbench/ask/AskPanel.tsx)
- [Reviewed browser dictation](sprink/apps/web/src/workbench/ask/speech.ts)
- [Hono API](sprink/apps/server/src/api.ts)
- [Agent workflow](sprink/packages/workflow/src/runner.ts)
- [Version-checked route selection](sprink/packages/planning/src/selection.ts)
- [Evidence validation](sprink/packages/core/src/evidence.ts)
- [Original project overview](README.upstream.md)
- [Original developer setup](sprink/README.md)

All original application source, tests, configuration and text documentation are included except the source-derived drawing dataset and drawing reference artifacts listed in [EXCLUDED-ASSETS.json](EXCLUDED-ASSETS.json). The only edit to an original text file removes a private local filesystem path from a historical audit. Original source identifiers and Git blob hashes are recorded in [SOURCE-MANIFEST.json](SOURCE-MANIFEST.json).

## Setup and omitted assets

This is a source review snapshot, not a turnkey installation. Follow the original developer setup after restoring the authorized assets you need. Do not place live credentials in this public directory.

The original code directly imports `sprink/packages/core/src/reference/itd-mezzanine.json`. That extracted drawing dataset is omitted; therefore the full application cannot build or run unchanged from this snapshot alone. Restore that exact authorized file at its original relative path and verify its original Git blob SHA against EXCLUDED-ASSETS.json. No dummy drawing data or substitute implementation has been inserted.

Other exclusions are reference/manufacturer PDFs, source-derived drawings, and unreviewed binary fixtures and screenshots. Tests and scripts using FS-01, PDF extraction, upload fixtures, drawing-reference verification or related browser scenarios need those files restored. Original README image links to omitted media will not render here. Synthetic fixture generator source remains available, but its generated files have not been recreated or validated for this snapshot. The app favicon and Sprink wordmark are included.

No build, test run, field-accuracy measurement or deployment is claimed for this export. The original source documentation records the project's own earlier checks and their limitations.

## Attribution and reuse

The original repository has no top-level license file. This snapshot does not add a license or imply new redistribution permissions for third-party materials. Existing dependency notices and attribution remain intact. Descriptions of the overall architecture refer to team work; they do not claim Jake authored every component. See the case study for Jake's specific contributions.

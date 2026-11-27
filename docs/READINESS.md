<p align="right"><strong>English</strong> | <a href="READINESS.ja.md">日本語</a></p>

# Portfolio review · 27 November 2026

[Demo directory](../projects/DEMOS.md) · [Reproduce the portfolio checks](VERIFICATION.md)

## Japanese navigation and content

Japanese case studies now cover SprinkMate, MemoryPath, CarePath, PBL4 and VisionPath / Shaky Walker alongside PENCIL Bridge. Pathway has a complete Japanese build story in its repository; AED has a Japanese project guide. The profile, project index, demo directory and engineering guides link these together with reciprocal English / 日本語 navigation. Original English stories, photographs, code and technical references remain available. Diagrams in the translated case studies use Japanese labels; original slide images remain unchanged.

Documentation language and app language are separate. PENCIL and AED offer bilingual interfaces. Pathway and CarePath retain their existing English interfaces; their Japanese guides explain how to try them. No private research repository was made public.

## Checks performed

| Project | Result | Scope |
|---|---|---|
| Portfolio | **38 tests passed**, all **306 source hashes matched**, and **231 local link/image targets resolved**. | Japanese profile and project pages included in link checks; external URLs and fragment anchors are checked separately. |
| SprinkMate | **340 tests passed**; workspace typecheck and production web build passed. | Node 22.19.0, pnpm 10.17.1, frozen lockfile. Tests include mocks; no paid provider or real field validation performed. Build warns about bundle size. |
| MemoryPath | **58 tests passed**; typecheck, lint and production build passed. | Reused the existing local dependencies after a disk-space failure. Model calls are mocked. Build emitted workspace-root and ESLint-plugin warnings. No real clinical data or live model request used. |
| Pathway | **27 tests passed**; syntax checks passed. Browser scenario selection updated the displayed triage. | Reconstructed engine and synthetic inputs; not an iPhone device test or a fall-detection accuracy measurement. |
| AED | **2 tests passed**; production build and GitHub Pages deployment passed. Public city filtering and facility selection worked. | Public prototype dataset. No emergency phone call or GPS permission request was triggered. Build warns about bundle size. |
| CarePath | Public prototype loaded; language filtering reduced results to the matching facilities. | Browser interaction check only. No model retraining or new backend build performed. |
| PENCIL Bridge | Earlier same-day check: both video players, language links, sample review and sample analysis passed. All 15 story photos and full text retained. | Phone-sized Chrome viewport, not physical iPhone Safari. |
| PBL4 | Japanese case study retains both photos, source links, implementation map and team delivery evidence. | Hardware demonstration and Python code belong to the academic team project. No new projector test performed here. |
| Research / HumanKey | Japanese project index describes current research and concept status. | No runnable product claimed. |

## Attribution maintenance

Removed bot author identities and AI coauthor trailers from this account's SprinkMate default-branch history. Human author identities were preserved; inherited bot-authored commits are labeled as team contributions, not reassigned to Jake. A local history backup and a commit mapping were retained. Every one of the 142 historical file trees was verified identical before publishing the rewritten history. Later commits add documentation only. GitHub may take time to refresh its contributor cache.

## Remaining deployment boundaries

SprinkMate and MemoryPath have local setup instructions rather than an anonymously accessible hosted app. Their provider-backed features need the documented keys and storage; this review did not create paid service credentials or public production systems. PBL4 requires its desktop environment and projectors. These distinctions are visible in the demo directory so reviewers do not mistake a video, research page or setup guide for a live application.

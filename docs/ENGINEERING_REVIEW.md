[Profile](../README.md) · [Run the public checks](VERIFICATION.md)

# Engineering review

A short route through the implementation, tests, and team contributions behind the portfolio.

## Start with Sprink

**My documented contributions:** the later mobile Ask interface, reviewed browser dictation, component tests, bounded requests, source context, and provider-error handling. Customer discovery, product direction, and pitching informed that work. The larger agent, planning, and verification architecture is a team effort with Yu Yoshimuta.

| Open this | Look for | Then inspect |
| :--- | :--- | :--- |
| [AskPanel.tsx](../projects/sprink-source/sprink/apps/web/src/workbench/ask/AskPanel.tsx) | The `inflight` ref blocks duplicate requests immediately; a sequence number prevents late responses from replacing current state. Dictation fills an editable draft rather than submitting it. | [15 component tests](../projects/sprink-source/sprink/apps/web/src/workbench/ask/AskPanel.test.ts) |
| [speech.ts](../projects/sprink-source/sprink/apps/web/src/workbench/ask/speech.ts) | A recognition session finishes once, cancels without adding text, detaches handlers, and bounds the wait after Stop. | [12 speech tests](../projects/sprink-source/sprink/apps/web/src/workbench/ask/speech.test.ts) |
| [askErrors.ts](../projects/sprink-source/sprink/apps/web/src/workbench/ask/askErrors.ts) | Authentication, timeout, and provider failures produce distinct recovery instructions. Raw server failure text is not used as user guidance. | [Error mapping](../projects/sprink-source/sprink/apps/web/src/workbench/ask/askErrors.test.ts) and component tests |
| [Server Ask workflow](../projects/sprink-source/sprink/apps/server/src/sources/ask.ts) | Retrieval, evidence context, provider failures, and bounded requests. This is a source-reading route; the public check below does not run the backend. | [Application source guide](../projects/sprink-source/README.md) |

### Decisions to discuss

- **Editable voice input:** recognition can mishear dimensions and technical terms. Keeping review and submission separate gives the worker a chance to correct the question.
- **Request identity as well as cancellation:** aborting a request does not by itself establish which response belongs to the current UI. The component also checks the sequence number.
- **Explicit failure states:** an unavailable provider, an empty search result, and a denied microphone request need different next steps.
- **Evidence before action:** source context and human confirmation remain separate from generated suggestions. The prototype does not establish installation compliance.

The 38-test public suite runs the existing frontend tests against the published source. Browser speech and HTTP responses are simulated by those tests. It does not measure actual speech recognition, source retrieval quality, or the full backend. [Commands and scope](VERIFICATION.md).

### Contribution provenance

The upstream history records these commits under Jake's GitHub account. They identify contributions, not exclusive authorship of the whole system. AI coauthor credit exists in the original history; the public snapshot does not reproduce the full upstream Git history.

| Contribution, 1 October 2026 | Upstream commit |
| :--- | :--- |
| Dictation controller and error wording | `52c9f94f3ee53faca2075a84d6e778d21625c16d` |
| Mobile Ask interface | `dff66e1d1e1d3363a3db75ec93964d20d46ae124` |
| Ask component tests | `120f90797c2bf7d09c2104635608588f47b2fe48` |
| Bounded requests and provider-error handling | `492074698afc6a661b390e455590dd1b00705621` |
| Evidence context, display rights, and demo provenance | `606be57fdbd8618d5ab62e18dd5d92d299dde1d7` |

The published snapshot is from upstream commit `7efa012b2e15f433aa39bba0fcbafeac04399d9f`. Its [manifest](../projects/sprink-source/SOURCE-MANIFEST.json) records the original paths and blob hashes. The portfolio check verifies all 306 archived files against their recorded local hashes. These improvements to review tooling were added in November, after the competition.

## Continue with MemoryPath

My work covered the concept, interviews, product workflow, and implementation contributions with Yu. The following are examples of the **team implementation**, not claims that I independently wrote every module.

| Engineering question | Code and tests |
| :--- | :--- |
| What happens to unsupported citations? | [Citation verification](https://github.com/Jsmitty78/MemoryPath/blob/main/src/lib/verify.ts) · [Proposal tests](https://github.com/Jsmitty78/MemoryPath/blob/main/tests/proposal.test.ts) |
| Can an older proposal overwrite a newer profile? | [Version guard](https://github.com/Jsmitty78/MemoryPath/blob/main/src/lib/approve.ts) · [Approval tests](https://github.com/Jsmitty78/MemoryPath/blob/main/tests/approve.test.ts) |
| Does generating a proposal change the approved record? | [Workflow contract tests](https://github.com/Jsmitty78/MemoryPath/blob/main/tests/safety-contract.test.ts) |
| What happens when optional retrieval is absent? | [GBrain adapter](https://github.com/Jsmitty78/MemoryPath/blob/main/src/lib/gbrain.ts) · [Fallback tests](https://github.com/Jsmitty78/MemoryPath/blob/main/tests/safety-contract.test.ts) |

[MemoryPath engineering guide](https://github.com/Jsmitty78/MemoryPath/blob/main/docs/ENGINEERING.md) explains what these checks establish and where local-file persistence, authentication, and concurrency still limit the prototype.

## Physical prototyping and team delivery

**[Pathway](https://github.com/Jsmitty78/Pathway-Oxford1stPlaceHackathon):** start with the [original detector](https://github.com/Jsmitty78/Pathway-Oxford1stPlaceHackathon/blob/main/vision/hazard_detector.py), then the [reconstructed engine](https://github.com/Jsmitty78/Pathway-Oxford1stPlaceHackathon/blob/main/src/pathwayEngine.js) and [27 tests](https://github.com/Jsmitty78/Pathway-Oxford1stPlaceHackathon/blob/main/test/hazardEngine.test.js). My event work included research, physical integration, testing, and pitching. The [reconstruction notes](https://github.com/Jsmitty78/Pathway-Oxford1stPlaceHackathon/blob/main/docs/RECONSTRUCTION_NOTES.md) distinguish the surviving event code from later portfolio work.

**[PBL4](../projects/pbl4.md):** compare the [baseline and gamma-corrected implementations](https://github.com/daitera1/PBL4-G1/tree/main/Development), then inspect the [weekly ownership and delivery record](https://github.com/daitera1/PBL4-G1/blob/main/Management/WEEKLY_REVIEW.md). My role was project management and practical setup support across a 12-person team. The final presentation and photographs document the team demonstration; no independent image-quality benchmark is claimed here.

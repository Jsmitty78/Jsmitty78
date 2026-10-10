# Sprink

**Turn drawings and site changes into actionable work packages.**

Sprink helps fire sprinkler fitters move from a field question or drawing to a reviewable next step: find the original reference, prepare materials and assembly information, or compare options when site conditions change.

Built for Innovation Cup 2026.

**[Watch the demo video](https://drive.google.com/file/d/19NsJLkqckJ90Wz9RkVEdC_G9nGbWRCAZ/view?usp=sharing)**

## Find the original

Ask a question about a sprinkler product or installation requirement. Sprink searches its registered reference library and opens the relevant original passage or PDF page, with its document and page context available for review.

![Rule search: ask about pipe preparation and open the original manufacturer instructions](docs/media/rule-search.gif)

## Prepare the work

Start from a drawing and confirm the scale, dimensions and inputs. Sprink prepares a materials list, cut-length information where the required inputs are known, and assembly steps linked to their references. Missing conditions stay visible alongside the result. Review the package and export PDF/CSV outputs.

![Materials and assembly: generate a package from a sample pipe drawing and inspect referenced steps](docs/media/materials-assembly.gif)

## Handle a site change

Record an obstruction and the measured space around the affected pipe. Sprink generates route proposals, compares material and length changes, and shows the checks and unresolved questions. The worker chooses a route and reviews the revised package.

![Site changes: compare route proposals around a duct and select a route for review](docs/media/site-change.gif)

*These GIFs are excerpts from the submission recordings. The materials and site-change clips are sped up; they do not show measured response times. The drawing examples are demonstration scenarios.*

## Technical design

**AI investigates. Scripts check. Workers decide.**

![Technical design: React, Hono, Pi and Astra, JEV, reference documents and verification scripts](docs/media/architecture.png)

| Component | Responsibility |
| --- | --- |
| React + Vite | Drawing and source views, input confirmation, proposal comparison and exports. |
| Hono + Node.js | Authenticated API, uploads, work-package revisions and PDF/CSV delivery. |
| Pi + GPT-6 Astra | Investigate saved evidence, choose tools, request missing information and explain results using Pi's standard agent loop. |
| JEV | Select verification rules from a catalog; also support reference retrieval. |
| Verification scripts | Run explicit applicability, input and domain checks; return detailed results and missing inputs to the agent. |
| SQLite + local files | Persist work packages, confirmed facts, source metadata, observations and artifacts. |

The slide's **Docs DB** represents the registered source library. **Scripts DB** represents the versioned rule catalog and executable scripts in the codebase, rather than a separate database service. React is the browser interface; the API and agent workflow run on the server.

The agent reads evidence → JEV selects a check → its script runs → the agent inspects the result and decides the next step. Human confirmation and route adoption are explicit saved actions. Changes to inputs invalidate outdated outputs.

## Prototype scope

Sprink produces reviewable work information. Missing evidence remains `unknown`, and a completed agent run or passing check does not establish full code compliance or construction approval. Coverage is limited to the implemented rules and supported inputs; see the [rule inventory](sprink/docs/rule-inventory.md). Field measurement accuracy and real-world installation outcomes are not established by the demo recordings.

[Local setup and development](sprink/README.md) · [Agent workflow](sprink/packages/workflow/README.md)

# Local-change candidate integration notes

Checked: 2026-09-26. This note records the boundary between the completed local-change slice and a future CPVC socket-joint candidate workflow.

- Candidate generation may reuse [`local-change-geometry.ts`](../packages/core/src/local-change-geometry.ts) for its bounded geometry arithmetic: explicit graph connectivity, supported straight segments/elbows, cut-length calculation from supplied port takeouts, and modeled duct-envelope checks.
- Reuse is arithmetic only. It does not establish candidate manufacturability, sprinkler-code compliance, product approval, or compatibility.
- `sf-local-change-2025` applies only to its confirmed San Francisco permit/design profile; its AB 2.04 checks are not generic CPVC product requirements.
- TFP171 selection and installation checks apply only to the identified TYCO head conditions. They do not establish CPVC pipe/fitting suitability.
- The current pipe/elbow dossier is a steel/threaded candidate comparison. Do not transfer its dimensions, pressure conditions, connections, approvals, or assumptions to Spears CPVC.
- Next material work is the Spears CPVC socket-joint method. Exact product/series and revision-specific primary documents are still required before encoding dimensions or limits.
- In particular, socket takeout/insertion depth, pipe/fitting size compatibility, pressure-temperature rating, joint procedure/material requirements, and sprinkler-system approvals remain unsupported here.
- Do not infer NFPA/AHJ acceptance, a listed joint, or a compatible pipe/fitting pair from matching nominal size or geometric fit.
- Keep unsupported or insufficiently evidenced candidate properties `unknown`; do not substitute the steel/threaded dossier or synthetic example values.
- The synthetic example verifies only its explicit geometry and BOM oracle: cut length 4.00 m to 5.76 m, with +4 pipe segments and +4 elbows; hydraulic direction remains unknown.
- Verified implementation state is distinct from future CPVC validation: the root-reported CLI/stdin/HTTP cases passed, all 473 tests and core/server/web typechecks passed, and the synthetic CLI example passed.
- Those checks establish behavior of the bounded current implementation only; they do not validate Spears product data or authorize a field design.

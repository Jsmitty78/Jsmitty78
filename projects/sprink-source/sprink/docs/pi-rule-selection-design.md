# Pi / Astra / JEV rule selection

This design records the user's 2026-09-27 agreement and supersedes the old operation-selection policy and closed issues #1/#2.

Pi runs its standard `Agent` loop with real GPT-6 Astra. Do not implement a custom loop/state machine or select actions outside the model; transport configuration only fixes model/authentication/options. Astra understands the work, inspects saved drawings, registered sources, answers and detailed results, invokes calculations, asks unresolved questions and explains results. Astra calls JEV to select one verification rule from the catalog; Pi executes that rule's script and returns its detailed result to Astra and the next JEV selection. JEV does not rank general business operations.

The catalog exposes rule ID/version, check, applicability description, subject types, necessary inputs, source/clauses, implementation status and execution function. Neither jurisdiction nor product code preselects the verification set. Selected scripts retain their own applicability and input checks. Pending sources and unimplemented rules remain visible. Selection finished, insufficient information and transport failure are distinct; communication errors never trigger fixed-order success fallbacks. Passing executed rules is not coverage or construction approval.

Before asking the user, Astra investigates available saved information. Questions, answers and results persist; a resumed run reads the latest revision. Human actions continue to own candidate adoption and confirmation of physical facts. Revision checks, cancellation, authentication and bounded execution remain in application code.

Both deliverables remain supported: drawing → materials/cut lengths/assembly/verification/export, and field difference → candidate routes/calculation/verification/comparison/human adoption/export. Reuse the existing domain engines, storage, APIs, PDF/CSV output and single server. Detailed tool results include subjects, unknowns, sources and references rather than success-only strings.

The only production model is `gpt-6-astra` through Responses. Project-local credentials take precedence over inherited credentials; no alternate-model fallback. Tests may explicitly inject a model stream, but production never synthesizes model calls.

Ownership during implementation: core catalog/individual scripts; workflow Pi/Astra/JEV loop; server domain integration/retrieval; root startup credentials, cross-layer verification and final integration. Cleanup removes only demonstrably superseded control paths and their exclusive tests/documentation. No commit, push or merge is authorized by this task.

Acceptance requires actual Astra → actual JEV → actual script → result-informed next action, saved question/answer resume and artifacts for both product flows. Synthetic input scenarios and mock regression tests are labeled separately from live service evidence and real field acceptance.

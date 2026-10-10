# Pi / Astra / JEV workflow

This package implements the agreed rule-selection tools on the standard Pi Agent loop. GPT-6 Astra runs inside the actual Pi agent loop: it understands the task, inspects saved drawings, registered documents and previous results, asks JEV which verification rule to run, executes that rule, and returns its result for the next decision. JEV selects verification rules, not general business operations. Start with one rule per selection/execution cycle.

The former fixture demo and business-action JEV smoke have been removed. They exercised code-selected operations and synthesized tool calls, so they cannot verify this design. The old issue-based connection plan is no longer the design authority. The runtime is integrated; live-service evidence and its limitations are recorded in `docs/verification/pi-astra-jev-rule-loop.md`.

## Responsibilities

- Astra handles task understanding, investigation, calculations/tool calls, questions and explanations. It must inspect available saved evidence before asking the user for information it cannot obtain.
- The rule catalog exposes each rule's ID/version, check description, applicability, target types, required inputs, source/clause, implementation state and execution function. Region or product code must not preselect a fixed set before JEV sees the catalog.
- Each selected script retains its own applicability and input validation. Missing sources and unimplemented checks remain visible.
- JEV clarification, transport failure and selection completion are distinct outcomes. Transport failure must not become successful fixed-order fallback work.
- Human answers, confirmed field facts and candidate adoption remain explicit, persisted user actions. A resumed run reads the latest saved state.

The two product flows are drawing → materials/cut lengths/assembly/verification/outputs, and site difference → reroute candidates/calculation/verification/comparison/human adoption/outputs. Reuse the existing domain engines, authenticated APIs and PDF/CSV exports in the single server.

## Boundaries to preserve

`DomainPort` in `src/contracts.ts` is the domain integration seam; `apps/server/src/integration/runtime.ts` adapts the shared work-package store and services. The server owns authoritative inputs and revision-bound publication. Tool results must expose per-target findings, missing information, sources and detail references to Astra, not only a success sentence.

Input/configuration version checks, cancellation, atomic commit, duplicate-run protection, bounded execution and saved run status remain necessary. Late or stale results must not publish. Model activity must not confirm evidence, invent dimensions, adopt a candidate or approve construction. A completed run, JEV stopping selection, or all executed rules passing does not establish complete coverage or installation approval.

The system model is fixed to `gpt-6-astra`, with no alternate-model fallback. Server startup must prefer the project-local `sprink/.env.local` OpenAI key over an inherited key without logging either. Use the existing JEV Choice transport and its response validation; changing the selection responsibility does not justify removing protocol/version checks.

## Verification

From `sprink`, with Node >=22.19 and pnpm 10.17.1:

```sh
pnpm install --frozen-lockfile
pnpm --filter @sprink/workflow typecheck
pnpm --filter @sprink/workflow test
```

Tests and synthetic fixtures are regression evidence only. Live acceptance must demonstrate real Astra → real JEV rule selection → actual script execution → Astra reading the detailed result and changing its next action. It must also cover saved question/answer resumption and both product flows through their artifacts. A provider-only request or fixture demo is insufficient. Run the opt-in live harness from `sprink`: `pnpm exec tsx scripts/verify-live-rule-loop.ts`. It uses the project-local API credentials and calls both paid services. Inputs and simulated human actions are explicitly synthetic. The harness judges actual rule execution, saved answer resumption, candidate adoption, current PDF/CSV outputs and manifest hashes, then deletes its dedicated temporary directory, database and artifacts on success, failure or SIGINT/SIGTERM. It retains only a compact console judgment with counts and limitations; no traces or exports are preserved. Use `--drawing-only` or `--site-only` to scope a paid run. Use `--check-cleanup` to check success, failure and signal cleanup without credentials or paid calls. Output destination arguments are not accepted.

Model comparison is opt-in: add `--model=gpt-6-sol --effort=low --budget-usd=3` (or `medium`). The budget cancels after reported usage reaches the cap, so an in-flight request can exceed it. Production stays on Astra low; there is no environment-driven model routing or automatic fallback. See [the measured comparison](../../docs/verification/pi-model-benchmark.md) for quality failures, costs and the decision.

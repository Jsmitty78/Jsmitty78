# PENCIL Bridge

**HR workflow prototype · Kyushu University QREC Venture Life Challenge**

Built during the PENCIL Co., Ltd. internship in the Kyushu University QREC Venture Life Challenge 2026. This is a student prototype, not an official PENCIL product.

[Public repository](https://github.com/Jsmitty78/pencil-people-bridge) · [Live demo](https://pencil-people-bridge.vercel.app)

[Back to my profile](../README.md)

## The question

How could HR organize information scattered across workplace conversations and prepare clearer follow-up questions?

Our team explored a prototype that surfaces possible missing context and conflicting information for human review. The goal was to help someone investigate an issue, not to score employees or automate personnel decisions.

## My contribution

I worked on product direction, prototype implementation, and the technical demonstration. I helped translate research and feedback into a bilingual interface with source-linked findings and a review workflow. PENCIL engineers and HR tried the prototype, and their feedback informed improvements to the workflow and presentation.

## Technical work

The prototype uses Next.js, React, and TypeScript. A detection screen stores fictional records in IndexedDB and sends bounded requests to a typed API. The API combines explicit rules with optional local Ollama analysis, then returns findings with evidence references and follow-up questions.

```mermaid
flowchart TD
    DATA["Fictional records in IndexedDB"] --> API["TypeScript detection API"]
    API --> DETECT["Rules and optional local model"]
    DETECT --> FINDINGS["Source-linked findings"]
    QUEUE["Separate seeded review demo"] --> REVIEW["Human review and CSV export"]
```

### Decisions that mattered

- **Bounded inputs and a timeout:** keep a malformed or slow request from making the demonstration unusable.
- **Deterministic fallback:** preserve a basic analysis path when the local model is unavailable.
- **Source references:** let a reviewer inspect the records behind a suggested issue.
- **Browser-local fictional data:** demonstrate the workflow without connecting to company systems.
- **Human review:** support follow-up and dismissal rather than treating a model output as a decision.

## What the prototype does and does not connect

The detection screen and the seeded review queue are separate demonstration flows. Detected findings do not automatically populate the review queue. The review interface supports state changes and CSV export; report sending is simulated.

Live workplace connectors, authentication, production delivery, and deployment governance are outside this prototype. Describing these boundaries is part of the engineering work.

## What I learned

An internal tool needs a clear place in an existing workflow. Useful questions, traceable evidence, and a familiar export can matter more than adding another dashboard.

## Team and field evidence

| Contributor | Contribution |
|---|---|
| Jake Smith | Product direction, prototype implementation, technical demonstration |
| Sydney Magnolia Tjandra | Design, filming, financial presentation support, presentation delivery |
| Takeshi Yamamoto | Employee research, engineering support, subtitles, presentation delivery |

My [internship post and 12-photo gallery](https://www.linkedin.com/feed/update/urn:li:activity:7506581096713752577/) document the two-week internship, employee interviews, feedback from PENCIL engineers and HR, and presentations at Kyushu University and PwC Japan in Fukuoka.

## A two-minute review

1. Open the public demo and select English or Japanese.
2. Open an example in the review queue.
3. Compare the source records and the conflicting instructions.
4. Review the proposed clarification question; choose follow-up, reviewed, or false positive.
5. Inspect CSV export and the simulated weekly report.

The stored-data detection lab is separate from the seeded review queue in the inspected source. That distinction matters when evaluating the demo.

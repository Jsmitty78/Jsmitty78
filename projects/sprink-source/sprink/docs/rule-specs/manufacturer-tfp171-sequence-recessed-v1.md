# Candidate manufacturer rules: installation sequence and recessed fit

Status: source reviewed and implemented in `packages/core/src/project-rules/manufacturer-extra.ts`; the retained manufacturer module has 34 focused test cases. Source: TYCO TFP171 document revision August 2026. This packet covers an as-built installation-sequence check and a phase-specific recessed fitting-face dimension. Each result is limited to its named condition and does not approve the sprinkler or system. Proposed assembly steps are requirements only and do not satisfy the historical as-built sequence check.

Source PDF: [Johnson Controls / TYCO TFP171](https://docs.johnsoncontrols.com/tycofire/api/khub/documents/JXGj~rL_f_FBVCY52uMTJw/content). I rendered and visually checked pages 3–5 (printed pages 3–5 of 8), including Figures 5–10 and the installation instructions. The recessed diagrams label the sprinkler-fitting face, mounting surface, style, model/K-factor/connection, and nominal dimension with tolerance. Page 5 gives the installation sequence and final closure-contact instruction. Values below use the source's inch dimensions, not a conversion of its rounded parenthetical metric values.

The existing rules already check the standard/recessed wrench type and the model's allowed escutcheon style. The separate manufacturer rule checks wrench engagement on the wrench flats. This packet adds procedure order and one published recessed separation dimension. The final closure-to-ceiling fit and bulb color checks are excluded because they concern post-installation inspection, not the proposed local reroute.

## Candidate 1: sealant and hand-tightening sequence

**ID:** `TFP171_INSTALL_SEALANT_HANDTIGHTEN_SEQUENCE_V1`
**Source:** p.5, standard Steps 2–3 and recessed Steps 1–2.
**Condition:** Standard TY-FRB installation requires pipe-thread sealant on the pipe threads, followed by hand-tightening the sprinkler into the fitting, then wrench-tightening. For recessed installation, the applicable mounting plate is installed over the sprinkler threads, pipe-thread sealant is applied to the pipe threads, and the sprinkler is hand-tightened; the next step is wrench-tightening. The source does not establish an order between mounting-plate installation and sealant application; it requires both before hand-tightening.

This remains an as-built history check: a confirmed uninstalled head is `not_applicable` to the completed-installation audit, but the local-change workflow must carry these source steps as planned assembly requirements. Proposed sequence facts cannot pass this rule. The bounded check is for a confirmed installed TFP171 Series TY-FRB model in an NPT connection, with standard or supported recessed mounting. A confirmed ISO 7-1 special connection remains `unknown` in this bounded check because the inspected installation examples use NPT connections. Unknown product, mounting, or connection scope remains `unknown`.

The installation record must independently establish these categorical facts (no numeric units):

- `pipeThreadSealantAppliedBeforeHandTightening`: `yes` or `no`. `yes` means the record confirms pipe-thread sealant was applied to the pipe threads before hand-tightening. A confirmed omission or application only after hand-tightening is `no`.
- `headHandTightenedBeforeWrenchTightening`: `yes` or `no`. A reliable record must identify both operations and their order, not merely state that installation followed the data sheet.
- For recessed mounting only, `mountingPlateInstalledBeforeHandTightening`: `yes` or `no`.

All required facts need evidence from the installation operation. For a recessed head, plate installation and sealant application must each precede hand-tightening; the source does not prescribe their order relative to each other. For either mounting, hand-tightening must precede wrench-tightening. A confirmed false required fact is sufficient for `fail` even if another required fact is missing; `pass` requires every applicable fact to be confirmed true.

| Oracle case | Inputs | Expected result |
| --- | --- | --- |
| Positive, standard | NPT standard head; the installation record confirms sealant, hand-tightening, then wrench-tightening | `pass` for these sequence steps only |
| Positive, recessed | NPT supported recessed head; plate and sealant both precede hand-tightening, which precedes wrench-tightening | `pass` for these sequence steps only |
| Failure: sealant missing or late | Installation record confirms sealant was omitted or was applied only after hand-tightening; other facts may be missing | `fail`; identify the sealant-before-hand-tightening step |
| Failure: hand-tightening/order | Installation record confirms the head was not hand-tightened before wrench-tightening, or wrench-tightening came first | `fail`; identify the sequence step |
| Failure: recessed plate order | Recessed installation record confirms hand-tightening happened before the mounting plate was installed | `fail`; identify the recessed Step 1 order |
| Boundary / incomplete record | Missing operation or ambiguous order, with no independently confirmed violation | `unknown`; do not infer compliance from final appearance |
| Applicability boundary | Head is confirmed uninstalled | `not_applicable` to this completed-installation audit; the future installation instruction remains applicable |

This check does not determine sealant brand, chemistry, amount, thread preparation, cure, final torque, leak-tightness, wrench type, wrench location, or any other installation condition. The existing wrench-type and wrench-flats checks remain separate. The source's instruction to “hand-tighten” is not converted into a torque value. For a proposed local change, surface the cited sequence as an installation requirement; the current history rule only evaluates evidenced completed work.

## Candidate 2: recessed fitting-face to mounting-surface dimension

**ID:** `TFP171_RECESSED_FITTING_SURFACE_DIMENSION_V1`
**Source:** p.3 Figures 5–6; p.4 Figures 7–10.
**Condition:** Measure the vertical separation shown between the face of the sprinkler fitting and the mounting surface, in inches, and compare it to the source figure for the confirmed model and recessed style. The figure prints a nominal value with an inclusive `±` tolerance; the intervals below are the direct inch arithmetic of those labels.

| Confirmed recessed model | Escutcheon style and figure | Printed fitting-face to mounting-surface dimension | Inclusive interval used |
| --- | --- | --- | --- |
| TY2231, 4.2K, 1/2-in. NPT | Style 10, Fig. 5 | 5/8 ± 1/4 in. | 3/8–7/8 in. |
| TY2231, 4.2K, 1/2-in. NPT | Style 20, Fig. 6 | 1/2 ± 1/8 in. | 3/8–5/8 in. |
| TY3231, 5.6K, 1/2-in. NPT | Style 10, Fig. 7 | 5/8 ± 1/4 in. | 3/8–7/8 in. |
| TY3231, 5.6K, 1/2-in. NPT | Style 20, Fig. 8 | 1/2 ± 1/8 in. | 3/8–5/8 in. |
| TY4231, 8.0K, 3/4-in. NPT | Style 40, Fig. 9 | 5/8 ± 1/4 in. | 3/8–7/8 in. |
| TY4231, 8.0K, 3/4-in. NPT | Style 30, Fig. 10 | 1/2 ± 1/8 in. | 3/8–5/8 in. |

Applicability depends on the explicit interval phase. For `phase: "planned"`, a revisioned drawing must establish the selected TY2231, TY3231, or TY4231 model, recessed mounting, style, NPT connection, and fitting-face/mounting-surface dimension. An installed-state fact is not required. For `phase: "as_built"`, an installed head and inspection evidence must establish those product/configuration facts and the measured datum interval. A model/style pairing not shown by these figures, a confirmed special ISO 7-1 connection, or an unresolved product combination is `unknown` for this bounded check; it must not be treated as a pass or as approval of that combination. A confirmed standard installation/selection is `not_applicable` to this recessed-dimension check.

Required fact: `recessedFittingFaceToMountingSurfaceInterval`, a confirmed interval `{lower: number, upper: number, unit: "in", phase: "planned" | "as_built"}`. The planned interval comes from the selected revisioned drawing and names both source datums. The as-built interval comes from a physical inspection or independently verified measurement record and names both physical datums. The interval endpoints explicitly represent measurement/design-dimension precision or uncertainty; a missing interval is unknown, never an implicit zero-width interval. An exact point is represented only when the caller explicitly supplies equal lower and upper bounds. Negative, non-finite, or reversed bounds, an omitted/unsupported phase, and a unit other than `in` are invalid input. Do not infer the distance from the visible escutcheon, nominal closure size, or an image without a scale and clear datum. A planned dimension cannot establish the installed dimension, and an as-built measurement cannot retroactively establish the proposal. The comparison uses the inches printed in the figures. Parenthetical metric values are rounded equivalents and can yield slightly different computed endpoints; metric-only input is not supported by this bounded check.

For an allowed interval `[L, U]`, return `pass` only when the whole confirmed measurement interval `[lowerBoundIn, upperBoundIn]` is inside `[L, U]`, including its endpoints. Return `fail` only when the whole measurement interval is below `L` or above `U`. If the measurement interval crosses either allowed limit, or is absent, reversed, non-finite, or otherwise insufficient to compare, return `unknown`; do not round it into the allowed interval.

| Oracle case | Inputs | Expected result |
| --- | --- | --- |
| Positive, planned | Revisioned drawing confirms a supported model/style and its entire planned dimension interval lies inside the figure range | `pass` for this selected drawing dimension only; does not establish as-built fit |
| Positive, as-built | Installed inspection confirms a supported model/style and the entire measured interval lies inside its figure range | `pass` for this measured separation only |
| Inclusive lower boundary | The full measurement interval is within the allowed interval and touches its 3/8-in. lower endpoint | `pass` |
| Inclusive upper boundary | The full measurement interval is within the allowed interval and touches its 7/8-in. (Style 10/40) or 5/8-in. (Style 20/30) upper endpoint | `pass` |
| Failure below | The full measurement interval is below 3/8 in. | `fail` |
| Failure above | The full interval is above 7/8 in. (Style 10/40) or 5/8 in. (Style 20/30) | `fail` |
| Boundary / uncertainty straddles a limit | The supported measurement interval overlaps, but is not wholly within or wholly outside, the allowed interval | `unknown`; preserve the measurement interval and do not infer zero uncertainty |
| Boundary / missing datum or phase | Product/style is supported but a datum, explicit phase, or supported interval is absent | `unknown` |
| Invalid interval | Negative/non-finite/reversed bounds or unit other than inches | Reject the input as invalid; do not return a compliance result |
| Applicability boundary | Confirmed standard-mounted sprinkler | `not_applicable` to this recessed geometry check |

The diagrams also show other dimensions and total escutcheon adjustment ranges. This candidate checks only the explicitly named fitting-face-to-mounting-surface separation; it does not check closure diameter, mounting-plate dimensions, total available adjustment, alignment, sprinkler-to-ceiling distance from another datum, or listing suitability.

## Shared result and evidence contract

Every fact is linked to evidence records for the same project and head. Model-generated claims remain unresolved. Sequence facts in this history rule require an installation record that identifies the operations and order; a planned sequence belongs in the separate change proposal and cannot pass this as-built rule. A planned dimension requires revisioned drawing evidence; an as-built dimension requires installed scope and inspection evidence. Each evidence record must establish the applicable model/style mapping, explicit phase, inch unit, and named fitting-face and mounting-surface datums. Otherwise the result is `unknown`.

## Deliberately out of this packet

This packet adds no numeric torque policy, pressure rule, project approval determination, or system-level code check. Recessed total adjustment and other dimensions not named above remain unimplemented. Approval/temperature/finish table combinations are specified in the separate table packet. Only the sequence candidate evaluates recorded installation history; the dimension check distinguishes drawing selection from measured as-built state. A passing result never certifies the whole sprinkler or system.

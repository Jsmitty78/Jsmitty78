# Candidate manufacturer check: wrench-flats engagement

Status: source reviewed and implemented in `packages/core/src/project-rules/manufacturer-extra.ts`. This is an as-built installation-history check only. A proposed local assembly must carry the manufacturer instruction as a requirement; a planned step cannot satisfy this historical check. Source: TYCO TFP171 document revision August 2026, printed page 5. A pass addresses the wrench contact location only and does not approve the sprinkler or system.

Source PDF: [Johnson Controls / TYCO TFP171](https://docs.johnsoncontrols.com/tycofire/api/khub/documents/JXGj~rL_f_FBVCY52uMTJw/content). The relevant page was rendered and visually checked. Figure 11 labels the wrench ends by NPT size; Figure 12 illustrates pushing the recessed wrench into engagement. The instruction text locates the wrench at the sprinkler wrench flats.

The current core separately checks standard-versus-recessed wrench identity (`TFP171_INSTALLATION_WRENCH_V1`). This check determines only where the wrench engaged.

## Rule: use the wrench flats

**ID:** `TFP171_INSTALLATION_WRENCH_FLATS_V1`
**Source:** p.5, standard Step 3 and recessed Step 2; Figures 1-4 and 1-3 respectively.
**Condition:** TFP171 instructs the installer to apply the sprinkler wrench to the wrench flats. It does not establish wrench torque, contact force, an alternate engagement region, or an angular tolerance.

The implemented result applies to a confirmed installed TFP171 model, confirmed standard or supported recessed mounting, and NPT connection. A confirmed uninstalled head is outside this completed-installation audit; the future assembly still needs the manufacturer instruction. For a confirmed ISO 7-1 special connection, the bounded rule returns `unknown`: the general instruction is present, but the wrench figures show NPT tool ends and do not establish the special-connection method.

Required categorical fact: `installationWrenchEngagementArea`, with values `wrench_flats` or `other_area`, supported by an installation-operation record. A completed-head photo cannot establish historical engagement. Missing, AI-generated, wrong-project/head, or superseded evidence leaves the result `unknown`.

| Oracle case | Inputs | Expected result |
| --- | --- | --- |
| Positive | Applicable installed head; work record confirms engagement on wrench flats | `pass` for this contact-location condition only |
| Failure | Applicable installed head; work record confirms wrench engaged outside the flats | `fail` and cite the TFP171 installation instruction |
| Boundary / missing history | No installation record, unreadable engagement location, or photo of the finished head only | `unknown`; do not infer the historical tool position |
| Boundary / special connection | Confirmed ISO 7-1 connection | `unknown`; source-specific application remains unresolved |
| Applicability | Confirmed model outside the TFP171 product set or head uninstalled | `not_applicable` to this as-built audit; this does not authorize a proposed installation |

The planned-assembly workflow should expose the same source step as a requirement separately from this check. Do not copy proposed assembly values into installed-head facts or report planned compliance as proof of completed work. This rule does not check sealant, tightening order, torque, approval, finish, or any system condition.

## Excluded from this change-oriented packet

Physical damage, post-factory alteration and combustion residue are maintenance/reuse checks and are not implemented by this extra module. A confirmed damaged or modified sprinkler may be relevant when selecting reusable components, but that condition needs its own explicit reuse decision and source review. Post-finish recessed closure contact and bulb-liquid color inspection do not describe the proposed pipe reroute and are excluded from this packet. Existing legacy head checks remain separate.

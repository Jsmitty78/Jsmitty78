# Manufacturer rule specification: listing, temperature, and finish tables

Status: source reviewed and implemented in `packages/core/src/project-rules/manufacturer-extra.ts`; the retained manufacturer module has 34 focused test cases. The checks below report whether a revisioned drawing-selected product configuration is represented by these manufacturer tables. They do not determine code suitability, the jurisdiction's required approval, or whether a specific unit's approval mark is authentic. This packet uses Tables A–C on printed pages 6–7 and Table E on printed page 8; Table D pressure ratings are separate and not implemented by these three rules.

Source PDF: [Johnson Controls / TYCO TFP171](https://docs.johnsoncontrols.com/tycofire/api/khub/documents/JXGj~rL_f_FBVCY52uMTJw/content). I rendered and visually inspected printed pages 6, 7, and 8, including all merged model/style/temperature/finish cells and footnotes. The table text was also extracted to verify the model rows and footnote references.

The exact Celsius values printed beside Fahrenheit temperatures are nominal catalog pairs, not exact mathematical conversions. For example, the sheet pairs 155°F with 68°C. Do not convert 68°C to 154.4°F and compare that computed value to 155°F. Resolve either printed value through the explicit catalog-pair mapping below; accept no tolerance or unlisted value by conversion. Although Tables A-C also print bulb-liquid color, that separate condition is excluded from this design/change packet.

## Shared exact temperature-pair map

| Catalog pair | Fahrenheit value | Celsius value |
| --- | ---: | ---: |
| `135F_57C` | 135°F | 57°C |
| `155F_68C` | 155°F | 68°C |
| `175F_79C` | 175°F | 79°C |
| `200F_93C` | 200°F | 93°C |
| `286F_141C` | 286°F | 141°C |

Represent the drawing-selected catalog temperature as `{value:number, unit:"F"|"C"}` and map it by exact equality against the corresponding source column. Either exact member of a printed pair maps to the same code. Do not convert between units or add a tolerance. A known number-unit pair that is not printed by TFP171 is outside this data sheet's temperature set; an unresolved drawing selection remains `unknown`.

## Candidate 1: model/style/temperature and named-agency matrix

**ID:** `TFP171_LISTED_TEMPERATURE_APPROVAL_COMBINATION_V1`
**Source:** Tables A–C, pp.6–7; definitions in the table footnotes.
**Condition:** For the drawing-selected product model and (if recessed) the drawing-selected recessed style, the exact selected catalog temperature must be a row in the appropriate table and the specific selected agency must be one of the codes shown for that row. This is a proposed-configuration table lookup; installation status is not required.

The required `approvalAgency` is one explicitly identified source-table organization/code: `UL`, `C-UL`, `FM`, `LPCB_007k_04`, `VdS`, or `LPCB_094a_06`. A generic `LPCB` value is insufficient because Table C distinguishes two references. The product model determines the standard upright/pendent row; a recessed head also requires its style. Table A–C approval cells visibly span the listed finish columns; a separate Rule 2 below checks whether a body-finish/temperature order variant is available. A pass means only that the selected configuration/agency appears in TFP171's table.

| Product configuration from the tables | Catalog temperature rows | Named agencies shown |
| --- | --- | --- |
| TY2131 upright or TY2231 pendent, standard, 4.2K, 1/2-in. NPT | all five catalog pairs | UL, C-UL |
| TY2231 recessed Style 10/Fig. 5 or Style 20/Fig. 6 | 135F_57C, 155F_68C, 175F_79C, 200F_93C only | UL, C-UL |
| TY3131 upright or TY3231 pendent, standard, 5.6K, 1/2-in. NPT | all five catalog pairs | UL, C-UL, FM |
| TY3231 recessed Style 10/Fig. 7 | all five catalog pairs | UL, C-UL |
| TY3231 recessed Style 20/Fig. 8 | all five catalog pairs | UL, C-UL, FM |
| TY4131 upright or TY4231 pendent, standard, 8.0K, 3/4-in. NPT | all five catalog pairs | UL, C-UL, FM, LPCB_007k_04, VdS, LPCB_094a_06 |
| TY4231 recessed Style 40/Fig. 9 | all five catalog pairs | UL, C-UL |
| TY4231 recessed Style 30/Fig. 10 | all five catalog pairs | UL, C-UL, FM |
| TY4831 upright or TY4931 pendent, standard, 8.0K, 1/2-in. NPT | all five catalog pairs | UL, C-UL, LPCB_007k_04, VdS |

Table C Note 4 states that LPCB 007k/04 does not rate the thermal sensitivity of recessed sprinklers. If the selected LPCB 007k/04 claim is for a recessed TY4231, return `unknown`/manual review; do not infer a recessed thermal-sensitivity approval or disapproval from the adjacent standard row. Other model/style/agency combinations not represented in this bounded matrix do not become approved because a similar row exists.

Required independently confirmed facts are selected from the same current, revisioned project drawing: TFP171 model; standard/recessed mounting; for recessed mounting, style; catalog temperature value with an explicit `F` or `C` unit; and the specific agency being selected. No installed-state inspection is required. Unknown required facts, drawing evidence mismatch/staleness, or an unsupported/ambiguous configuration yield `unknown`. A confirmed catalog temperature with no row for that model/style, or a selected agency not shown for a mapped row, yields `fail` **for this TFP171 table-membership check only**. It does not claim the model is unlisted by every other source or authority, nor that a physical unit carries an authentic approval mark.

| Oracle case | Inputs | Expected result |
| --- | --- | --- |
| Positive standard | TY3131 standard; 200°F or its exact printed pair 93°C; claimed FM | `pass`; Tables B show FM for this standard row and temperature |
| Positive recessed | TY3231 recessed Style 20; 286°F or 141°C; claimed FM | `pass`; Table B Style 20 row includes code 3 (FM) |
| Positive proposed selection | A revisioned drawing selects one of the supported model/style/rating/agency rows; the selected head is uninstalled | `pass` for the matching table row only; this does not attest to an acquired or installed unit |
| Temperature-pair equivalence | The same product is entered once as 155°F and once as 68°C, with the same row/agency | Same outcome; both map to `155F_68C`, with no mathematical conversion |
| Failure: recessed temperature absent | TY2231 recessed Style 10 or 20; confirmed 286°F or 141°C | `fail`; Table A has no 286° row for the recessed TY2231 configuration |
| Failure: agency absent | TY2131 standard at a listed temperature; claimed FM | `fail` for this table-membership check; Table A shows UL/C-UL only |
| Boundary: recessed LPCB sensitivity | TY4231 recessed; claimed LPCB_007k_04 | `unknown`/manual review because Table C Note 4 excludes thermal-sensitivity rating for recessed sprinklers |
| Boundary / unresolved facts | Drawing-selected model, style, agency, or exact temperature/unit cannot be independently resolved | `unknown`; do not round or convert to force a match |

This candidate checks an explicit requested agency, not whether that agency is the correct choice for a jurisdiction or project. A `pass` does not verify a particular unit's label, current listing status, corrosion resistance, installation, or system acceptability. The rule returns no blanket “approved” conclusion for all of a sprinkler's possible agencies.

## Candidate 2: body-finish and temperature part-number availability

**ID:** `TFP171_SPRINKLER_BODY_FINISH_TEMPERATURE_AVAILABILITY_V1`
**Source:** Table E, p.8, including notes 1–4.
**Condition:** Check whether the drawing-selected sprinkler-body finish and exact catalog temperature pair are represented as a part-number combination for that model, observing the listed exceptions and the Eastern-Hemisphere restriction for Pure White Polyester. This is proposed product selection, not proof that a particular unit was manufactured, listed, or stocked.

Table E body-finish codes are `1` Natural Brass, `3` Pure White Polyester (RAL 9010), `4` Signal White Polyester (RAL 9003), and `9` Chrome Plated. Its temperature-code pairs are the five exact pairs in the shared map above. Pure White Polyester is stated as Eastern-Hemisphere sales only. The “Recessed Escutcheon” finish choices on p.3 are a separate product; this candidate checks sprinkler body finish only.

The table notes these explicit unavailable combinations:

| Body finish | Unavailable model/temperature pair(s) |
| --- | --- |
| Natural Brass | TY2231 at 286F_141C; TY3131 at 135F_57C |
| Pure White Polyester (RAL 9010) | TY3231 at 200F_93C; all other combinations only for Eastern-Hemisphere sales |
| Signal White Polyester (RAL 9003) | TY3131 at 175F_79C, 200F_93C, or 286F_141C; TY3231 at 175F_79C |
| Chrome Plated | TY3231 at 135F_57C |

Applicability is limited to a drawing-selected TFP171 sprinkler-body model and a catalog-temperature pair listed for that model/configuration in Table A, B, or C. The selected model, mounting/style, temperature, and finish require current revisioned drawing evidence; a planned/uninstalled head is in scope. A valid standard model or recessed variant uses its own source-table row. If the temperature/model/style itself is absent from Tables A–C, Candidate 1 reports that condition and this availability rule is `unknown` rather than inventing a finish row. A selected body finish outside the four Table E options is `fail` for this data-sheet table check. Pure White requires independent evidence of the proposed sale's hemisphere (drawing or permit evidence accepted by the implementation): confirmed Eastern is within its geographic condition; confirmed non-Eastern is unavailable; missing/ambiguous hemisphere is `unknown`.

| Oracle case | Inputs | Expected result |
| --- | --- | --- |
| Positive | TY2131 at 135F_57C, Natural Brass | `pass`; no Table E exception applies |
| Positive, geographic condition | TY2231 at 155F_68C, Pure White, Eastern-Hemisphere sales confirmed | `pass` for Table E availability only |
| Failure: Natural Brass | TY2231 at 286F_141C or TY3131 at 135F_57C, Natural Brass | `fail`; exact Table E Note 1 exception |
| Failure: Pure White model/temp | TY3231 at 200F_93C, Pure White | `fail`; exact Table E Note 2 exception |
| Failure: Signal White | TY3131 at 175F_79C/200F_93C/286F_141C, or TY3231 at 175F_79C, Signal White | `fail`; exact Table E Note 3 exception |
| Failure: Chrome Plated | TY3231 at 135F_57C, Chrome Plated | `fail`; exact Table E Note 4 exception |
| Failure: sales hemisphere | Any otherwise available Pure White combination for a confirmed non-Eastern-Hemisphere sale | `fail`; Table E limits Pure White to Eastern-Hemisphere sales |
| Boundary / missing geography | Pure White selected on the drawing but sales hemisphere is not independently known | `unknown`; do not assume the region |
| Boundary / invalid temperature row | Model/style/rating has no Table A–C row | `unknown` here; no part-number availability inferred |

The data sheet calls this a part-number selection table and directs users to contact a distributor for availability. This candidate checks only the table's catalog combination and stated geographic restriction; it does not prove current stock, local sale authorization, agency acceptance, or appropriateness for the environment.

## Shared result and evidence contract

The selected product model, mounting/style, body finish, exact catalog temperature pair, named agency, and (for Pure White) proposed sales region each remain independently confirmed facts supported by current revisioned drawing evidence; sales-region evidence may also be a project permit. A model-generated estimate is a candidate only. The TFP171 table lookup must preserve the exact source row and footnote references. Unsupported configurations stay `unknown`; no pass/fail result should be generalized to an actual unit's label, product listing by another agency, local suitability, bulb color/integrity, or system compliance.

## Deliberately out of this packet

This packet does not determine ambient-temperature suitability, required agency for a project, accepted listings by an AHJ, corrosion-resistant suitability outside the explicit polyester footnote, or current distributor stock. It does not claim the recessed escutcheon's finish matches the sprinkler-body finish. It does not check bulb-liquid color, ambient-temperature suitability, or any Fahrenheit/Celsius equivalence other than the exact catalog pairs printed in Tables A–E.

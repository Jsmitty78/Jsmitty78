# Product selection and evidence boundary

Retrieved and visually checked on 2026-09-26. URLs, page references, and SHA-256 digests are embedded in `src/catalog.ts` and exported with every package. Source files were inspected in a temporary directory, not copied into the repository.

| Primary manufacturer document | Facts used |
| --- | --- |
| [FlameGuard Technical: General Information](https://parts.spearsmfg.com/sourcebook/FGTECH_FG-1_T_FGGI_T.pdf), PDF page 1 / printed page 5, undated | CP-010 NPS 1 SDR 13.5, OD 1.315 in. G denotes centerline intersection to socket bottom; H denotes intersection to face. G/H dimensional tolerance +/-1/32 in. FS-5 recommended for Spears products. |
| [FlameGuard CPVC Sweep 90 Elbows](https://www.spearsmfg.com/flameguard/027-FG90S-2-0723_0824_web.pdf), FG90S-2-0723 printed 08/24, pages 1-2 | Socket ends for CPVC sprinkler pipe. 4206-010S NPS 1 row: G=1-5/16 in, H=2-3/8 in. The drawing locates both dimensions. |
| [FlameGuard installation instructions](https://www.spearsmfg.com/flameguard/03-FG-3_0321_web.pdf), actual cover FG-3-1223, December 20, 2023 | Pages 24-28 supply the socket procedure; pages 39-40 address modifications/cut-ins and movement. The URL's older identifier does not identify the downloaded revision. |

The operation template summarizes cutting, beveling, fit inspection/cleaning, cement application, full insertion while turning, holding, then set/cure. It records the manufacturer's quarter turn and 30-second hold. The full manual and applicable conditions remain governing. A confirmed cure-plan input is required; the engine does not extrapolate cure times or substitute a universal duration. The example's 90-minute minimum refers to the 1-inch, 60-120 F, up-to-225-psi row and is only fixture context.

Source-backed nominal math is G=0.0333375 m, H=0.060325 m and H-G=0.0269875 m. Nominal cuts do not include an invented field allowance or remove manufacturer tolerances. Verify actual components, fit, installation conditions, and project suitability before fabrication.

The earlier Wheatland/Anvil threaded candidate was not used: its axial makeup and selected pipe-end compatibility remain unresolved. No turn-to-linear conversion, mixed product revision, nominal-size-to-OD substitution, or pressure/listing transfer is implemented.

The source-backed positive example demonstrates detailing of a prefabricated two-pipe/one-elbow spool using real catalog dimensions and procedure references. It does not establish physical fit, onsite measurements, environmental conditions, final field closure, system performance, or a release-level complete positive Scenario 3 installation. Those remain integration/field acceptance work.

## Steel extension (#10, retrieved 2026-09-27 UTC)

The **earlier malleable-iron candidate** above is still not a confirmed FS-01 match.
This extension selects separate black steel / cast-iron families. Source revisions
and downloaded SHA-256 digests are in `src/steel-catalog.ts`.

- [Wheatland A53 Schedule 40 submittal](https://www.wheatland.com/wp-content/uploads/2017/12/ASTM-A53-Schedule-40-Submittal-Sheet-1.pdf), WFS-101025: page 1 identifies threading suitability and manufacturer UL/FM claims. NPS 2 OD is 2.375 inches; NPS 1 OD is 1.315 inches. Actual supplied pipe type/end preparation and project approval remain unresolved.
- [Anvil Fig.351 submittal](https://www.asc-es.com/resources-and-downloads/351-90-elbow-straight-submittal), PS-SUB-351-v01 20211022: pages 1-2 specify cast iron, ASME B16.4 / B1.20.1; page 3's **B** is center-to-face (NPS 2: 2.25 inches; NPS 1: 1.5 inches). **A is not the face datum.** Page 4 provides thread inspection, sealant and makeup sequence. It does not provide a final axial engagement datum. Exact fitting listing scope needs further confirmation; pipe listing claims are not transferred to the fitting.

The paired catalog identities are dimensional candidates. They do not assert
manufacturer cross-brand joint certification, a purchase SKU, or job approval.
R2 still has no actual product selected from FS-02's material requirement alone.
There is no default for MSU FP2.1. `STEEL-CONTRACT.md` documents explicit inputs.

The positive **software arithmetic fixture** is an invented open-ended spool with
609.6/457.2 mm centerlines and 12/15 mm final axial engagements. NPS 2 cuts are
564.45/415.05 mm; NPS 1 cuts are 583.5/434.1 mm. These are independent hand
calculations, not measurements. Missing, foreign, or product-mismatched engagement
keeps cuts unknown. No turn-to-distance conversion is used.

Complete positive product/field acceptance remains open: obtain actual scoped
engagement and physical-length evidence, fitting listing/compatibility and project
suitability review, end-preparation/tool/sealant review, and practitioner-reviewed
assembly. #29 owns fixed-end closure components and sequence; #12 owns generation
and protected context. The Draft PR does not close #10 or the #8 acceptance gate.

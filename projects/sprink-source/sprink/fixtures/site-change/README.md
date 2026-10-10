# Site-change browser acceptance inputs

`fs01.pdf` is the public Idaho Transportation Department FM32361 fire sprinkler drawing:
https://apps.itd.idaho.gov/Apps/NonHwyConstructionProjects/PDFS/FM32361_ITB_Drawings_Fire_Sprinkler_Plan.pdf

SHA-256: a21d5748d0b7f15bea1da772fdb41a424651cb1e717534177b5144c6d51eef1f

Source interval P27: PDF points (1830.4,1784.07) to (1830.4,1874.06),
printed scale 1/8 inch = 1 foot, 33.8666666667 mm/PDF point.
Independent projected length: 89.99 * 33.8666666667 = 3047.661333 mm.
AI pipe/head endpoint locations are checked within 3 PDF points of these independent annotations, allowing raster/annotation precision. All 15 explicit site labels are checked on the original AI proposal before human adoption.
Its steel material is preserved. No physical steel cut lengths are established.

`site-dimensions.svg` and its rendered PNG are developer-authored, explicitly
synthetic field information. This is not a photo of the actual job. Every
coordinate and envelope allowance is fictional. The displayed rectangles are
illustrative, not to scale; printed dimension values are the oracle.

With 60.325 mm steel OD and the stated 100 mm surface clearance, independent
midpoint lanes are Y=775 and Y=-875 mm. Added centerline lengths are 1550 and
1750 mm, and each detour adds four elbows. Z detours do not fit the work bounds.
The 100 mm fitting and 150 mm assembly box envelopes fit the Y detours. A
900 mm fitting envelope must fail. These expectations precede the browser run
and are not copied from generated candidates.

`ambiguous.svg` / `ambiguous-rotated.png`: a 90-degree rotated synthetic source.
`duct.min.z=-300` is readable; `duct.max.z=3?0` must remain null/uncertain;
`workEnvelope.max.z=UNKNOWN` must not become a number. A separate explicit human
clarification in the browser sets duct.max.z to 300, retaining the original proposal.

Existing preparation regression specimen (separate from the steel case): 24 and
18 inch open-end CPVC legs with a 1 5/16 inch center-to-socket-bottom catalog
reference would give 0.5762625 m and 0.4238625 m cuts. The current browser sample
fails the physical-end evidence precondition; those values are expectations, not
claimed browser results, and no synthetic-to-real promotion is permitted.

## Manufacturer nominal-length preparation specimen

`Spears 018-FGPS-1-0624_0624_web.pdf`, actual PDF page 44 / printed page 45,
https://www.spearsmfg.com/flameguard/018-FGPS-1-0624_0624_web.pdf

The lower table specifies plain-end CP-010, 1 inch, nominal 15 ft stock.
The separate upper table is CP-010-10 at 10 ft; it must not be substituted.
Independent nominal end-to-end length: 15 × 0.3048 = 4.572 m.
The one-page extract is used as source drawing. Calibrating the lower diagram
applies only to that nominal dimension; this is not a surveyed installation or
a claim that all illustrations on the catalog page have one scale.

spears-pipe-dimensions.pdf SHA-256: 619ed77aa28f5d15495c22c230b0ec66ff60c1a644fa93f9f5e014cefecfdf1d

spears-pipe-lengths.pdf SHA-256: 06a21b4d066b6676b1c8e6cf53d2a9c60245cbc2e0d11b565e87f8d830e7994b

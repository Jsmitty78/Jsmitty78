# Independent arithmetic fixture

All values are synthetic test data, not a product recommendation, construction allowance, or manufacturer specification. Inputs contain no candidate route. The expected arrays in `duct.ts` were calculated independently of the implementation.

Frame: room-frame. Units below: metres. Fixed endpoints A=(0,0,0), B=(10,0,0). Pipe outside diameter=0.2; radius=0.1. Duct=[4,6] × [-0.4,0.4] × [-0.5,0.5]. Work bounds=[-0.2,10.2] × [-2.8,2.3] × [-0.3,0.3]. Explicit required pipe surface clearance=0.1. Synthetic elbow center-to-face=0.15, makeup=0.05; net takeout=0.10. Each tie-in's net cut offset=0.05.

Expanded duct limits along X are 3.8 and 6.2. Lead-in stations are (0+3.8)/2=1.9 and (10+6.2)/2=8.1. Their separation is 6.2.

Positive Y free lane interval=[0.6,2.2]; midpoint=1.4. Negative Y interval=[-2.7,-0.6]; midpoint=-1.65. The work bounds do not allow a lane beyond the expanded Z duct range, so both Z templates are rejected. The direct pipe intersects the duct.

| Metric | Baseline | Positive Y | Negative Y |
|---|---:|---:|---:|
| Pipe pieces | 1 | 5 | 5 |
| Added elbows | 0 | 4 | 4 |
| Centerline length | 10 | 12.8 | 13.3 |
| Added centerline length | 0 | 2.8 | 3.3 |
| Total cut length | 9.9 | 11.9 | 12.4 |
| Cut length delta | 0 | 2.0 | 2.5 |

Positive Y centerline segments=[1.9,1.4,6.2,1.4,1.9]. Cuts=[1.75,1.2,6.0,1.2,1.75], subtracting 0.05+0.10 at the tie-in pieces and 0.10+0.10 at the three internal pieces. Negative Y replaces the two 1.4 segments with 1.65, giving cuts=[1.75,1.45,6.0,1.45,1.75]. Four elbows have eight ports; total takeout including tie-ins=8×0.10+2×0.05=0.90.

Changing only the lower Y work boundary to -0.5 leaves one candidate. Also changing the upper Y boundary to 0.5 leaves none. Increasing synthetic center-to-face to 1.55 (net=1.50) makes the transverse cuts negative and both detours must be rejected. Clearing makeup or a tie-in cut datum leaves the relevant cuts unknown, not zero. None of these variants changes fixed ends, heads or the observed duct to manufacture a solution.

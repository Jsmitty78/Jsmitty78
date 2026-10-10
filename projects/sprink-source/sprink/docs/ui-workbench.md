# Sprink workbench (issues #11 and #12)

The Sprink UI has one login and shared navigation: work packages at `/` (`/api/work-packages`) and field inspections at `/inspections` (`/api/tasks`). Old `/legacy` bookmarks redirect to `/inspections`; the old app shell and stylesheet have been removed. The UI uses custom CSS, without a component-library dependency.

Code: `apps/web/src/workbench/`. The UI calculates nothing: cuts, quantities, routes, deltas and rule findings all come from the server. The UI converts units for display (ft-in to the nearest 1/16 in, plus mm) and says so on screen.

## Drawing workspaces and language

The header keeps Materials & assembly, Site changes and Codes beside the Sprink logo. Materials and assembly stay linked to the drawing through part and material-group selection. Site observations open over the drawing; suggested routes and their material deltas appear beside it. Code search pairs the question and answer with the cited source, and returning preserves drawing selection and zoom.

EN / JP switches the interface without remounting the workspaces, so draft observations and search results survive. The preference persists in browser storage. User input, source passages, catalog names and generated service output retain their original language. Drawing setup, detailed measurements and checks are secondary panels; the site-frame, provenance and retained-context behavior remains available there.

## Workflows

**Prepare from a drawing (#11).** This workflow needs no obstruction or change request.
1. Upload the sheet (PDF, PNG or JPEG) and set the revision and page. Confirm the scale.
2. Enter the run as ordered points: a tie-in or open end at each end, 90° elbows in between. The editor writes the plan contract in the same shape as the server fixture. Nothing is routed or sized on the client.
3. Confirm the run dimensions against the drawing. The server then freezes the baseline.
4. Confirm the end datums, tie-in net cut offsets, joint movement, access, cure plan and project basis.
5. Generate. The panel shows materials, the cut list, assembly steps and checks with their sources.

Selecting a piece on the plan or in the cut list highlights it in both places. The row also shows the server's deductions and the checks for that piece.

**Adapt to site conditions (#12).** This can be opened directly, without running Prepare first.
1. Enter the existing run and the drawing, choose the affected piece, and enter the measured duct box, work boundary, clearance and photos.
2. Generate route alternatives and preview each one on the plan. The comparison shows fittings, the centerline change, pieces and assembly steps. Rejected layouts are listed with their reasons.
3. **Use Route X** records your selection, then builds the revised package. That package has the full quantities and cut list, plus the change from the original taken from the server's `delta`. The original baseline is kept and stated.
4. Export makes the PDF, materials CSV and cut list CSV through the server's exporter, bound to the input revision.

## Field inspections

The Field inspections navigation opens existing task records without conversion. It preserves creation and cancellation, drawing orientation revisions, photo upload and viewing, manual fact corrections with evidence, additional requests and answers (including unavailable reasons), saved measurements, synthetic replays, validation, and JSON report generation/download. Domain panels live under `apps/web/src/workbench/inspections/` and use the shared Sprink controls and colors. The task and package APIs and stored records are unchanged.

## States handled

- **Unknown values:** a cut, quantity or delta the server reports as unknown shows "Unknown" with the server's reason. It is never shown as 0. An empty measurement is saved as unknown.
- **Missing inputs:** a checklist of what is still needed. Generate is blocked only where the server would fail outright (see the gaps below).
- **Server questions:** an open request can be answered as unavailable.
- **Stale results:** results stay visible, labelled with the revision they belong to, beside a Regenerate action. Stale routes are drawn faded.
- **Selection:** selected, applied and previewed routes are labelled differently. Changing inputs while a route is selected clears the selection first (the server keeps it otherwise), and the UI says so.
- **Route results:** no route found, only one route, and a route with an unknown length (which cannot be selected) each have their own state.
- **Run status:** loading, running (with a cancel button), blocked, failed and empty.
- **Approval:** the UI always shows "Not construction approved". The server reports construction approval as not assessed, and no API records it.

## Sample data

**Load sample input** fills an empty package through the real API. It uses invented test assumptions and draws a PNG sheet labelled SAMPLE DRAWING. Every sample fact is marked as a synthetic assumption with a `SAMPLE:` source, and the package shows a Sample data badge. The preparation sample's drawing scale and baseline run remain proposed. It uses two tie-ins so it can produce a draft without treating fictional physical pipe ends as confirmed; its dependent cut lengths remain unknown. Before running it, the user must acknowledge that the current revision's inputs are fictional. JEV may then choose an applicable provisional check; an UNKNOWN finding remains unresolved evidence, not construction approval. No fixtures are bundled into production code paths.

## Backend gaps found while integrating

1. **Drawing alignment.** Closed by #27: `sourceDrawing.view` saves the sheet unit, work area, calibration and plan frame. See [Drawing intake](#drawing-intake-issue-27).
2. **Scale calibration.** Closed by #27: two-point or printed-scale calibration, checked by the server.
3. **`runner_failed` hides the cause.** `fabricationInput` throws on structural problems instead of publishing a gap or request. An open end without a confirmed `physical_pipe_end` datum is one example. The UI pre-checks that case (`runBlockers`) and explains the bare `runner_failed`.
4. **Evidence photos have no field.** Photos are stored as site facts `evidence.photo.N` with `source.assetId`. The adapter ignores unknown fields, so this is safe, but the evidence belongs in the contract.
5. **Selecting a route bumps the input revision.** The candidate set becomes stale right after a choice, so switching routes needs a regenerate. Changing site facts does not clear the selection on the server.
6. **`GET /:id/detail` is not in `docs/contracts/work-package-api.en.md`.** Callouts, centerlines, takeouts and `delta` come from it. The UI treats it as optional and works from the snapshot alone.
7. **Rule findings have no title or rule id,** so findings are grouped by their reason text.
8. **Answers can only mark information unavailable.** Real values go through fact edits, as the server comment says.

## Not done yet

- Supports and branch trees in the tracer. It handles one open run, with heads and adjacent pipe as context.
- The route planner does not read photos. They are evidence only.
- The obstacle is not drawn on the sheet view, only on the plan and in the site views.

## Drawing intake (issue #27)

The Inputs tab (and the Site evidence tab for adaptation) starts with **Drawing and trace**. It is the same component in both workflows, so adaptation never needs a preparation package first.

1. **Upload** a PDF, PNG or JPEG. Uploading never marks the drawing approved. "Copy of" names the original when the file is a scan, crop or raster.
2. **Page and work area.** A PDF page is chosen from its real page count; each page is its own view, so switching page starts its area, scale and trace over. The work area is a box dragged on the sheet and is drawn sharply at up to 4096 px on its long side.
3. **Scale.** Either two picked points and their real length in ft, in, mm or m, or (PDF only) a printed ratio such as 1/8 in = 1 ft (PDF points are 1/72 in of paper). The server re-derives a two-point scale and rejects one that does not match (`scale_calibration_mismatch`). The pick precision (half a screen pixel at the zoom used, converted to mm) is saved as `pointUncertaintyMm`; it is not a construction tolerance.
4. **Plan frame.** `plan = rotate(rotationDeg) · ((x − origin.x) · scale, −(y − origin.y) · scale)` in mm, Z up. The Y flip makes the frame right-handed. Picking two points along a line sets plan X, so a rotated copy gives the same plan geometry.
5. **Trace.** Clicks along the run, in order. Ends are *interfaces* (where this work meets something else; a scope boundary, not a physical end or a joint) or open ends; points between are turns. A head at an end station is marked as a retained head. Heads elsewhere and adjacent pipe are context. Context entities are saved in the plan outside `scope.includedEntityIds`, never connected, and the runner keeps them out of materials and assembly. Coordinates can be typed exactly in the table. Sheet labels (P27, H1) are saved as `sourceLabel` facts; entity ids stay project-local (`p1`, `t1`, `h1`).
6. **Product.** None is assumed. "Not selected yet" saves `productId: null`, so cuts and procedures stay unresolved. The CPVC catalog set can be chosen explicitly; the typed-coordinates editor has the same choice.
7. **Source requirements.** Nominal size as printed, required material and requirement text, with where it is stated. A catalog choice that conflicts with the stated material is shown as a conflict.
8. **Confirm trace** freezes the plan together with the drawing, scale and frame, as the server already did for the run editor.

The trace is kept in this browser until it is saved, so a reload before saving keeps clicked points. A trace cannot be saved without a scale, because plan positions are millimetres.

Not in #27: automatic extraction. The FS-01 vector extraction (`packages/core/src/reference/itd-mezzanine.json`) stays an optional fixture and is not wired into the intake. Drawing rendering uses pdf.js in the browser; Ask Sprink parses reference documents separately on the server, and the two could share a PDF layer later.

## Site geometry (issue #28)

The Site evidence tab records a discrepancy as reviewed geometry, never as a reroute.

1. **Site condition.** What was found and which in-scope span it blocks (`changeRequest`).
2. **Site frame.** Pins the explicit local frame of `docs/contracts/adaptation-interval.md` to a span: the four detailing facts `adaptationFrame.origin.x/y/z` (mm) and `adaptationFrame.yaw` (degrees), origin at the span start and yaw along it. X runs along the span, Y is level to the left of the pipe (the frame is right-handed), Z is up with 0 at the pipe centerline. The panel prints the plan and drawing formulas. For FS-01 P27 on the intake frame it prints `Drawing XY = (12544.2133 + Y, 9620.504 + X)`. The #1 acceptance mapping `(12544.2133 − Y, 9620.504 + X)` puts Y to the right, a mirrored frame the contract does not accept yet, so a value given that way is entered with its Y sign flipped.
3. **Obstacle and work boundary.** Six faces each, entered in mm or ft-in and stored in mm with full precision, in the local frame when one is saved (main's `adaptationFrame` maps them to the drawing), otherwise in the plan frame.
4. **Basis.** Every value is either *Measured on site* or *Test assumption (fictional)*. A test assumption is stored with the `ASSUMPTION:` source prefix, shown with its own badge, and exported as `TEST ASSUMPTION`. *Save* stores the values as proposed; *Confirm* marks them confirmed and never changes the basis. An evidence photo can be linked; the numbers never come from it.
5. **Clearance.** The required surface clearance is labelled a test parameter, not a regulation. Pipe OD comes from the catalog product and is never inferred from the nominal size.
6. **Missing values.** Each missing face is listed by name (for example "Obstacle height (Z): both faces missing"). Changing the frame keeps the box numbers but sets them back to proposed, so they must be confirmed again; every edit also clears a route selection and makes candidates stale by revision.
7. **Plan and elevation.** X-Y and X-Z views of the span, obstacle and work boundary as saved.

![Site frame on FS-01 P27](ui/site-frame.png)

![Obstacle entered as a test assumption](ui/site-duct-panel.png) ![Work boundary missing its height](ui/site-missing-height.png) ![Plan and elevation](ui/site-views.png)

The export PDF now lists every saved input with its basis and status (`inputs` in the export snapshot). Generating routes around the box stays with #12: the planner still refuses a baseline with head entities, including retained context heads.

## Preparation results (issue #11)

What a drawing-only package (R2 in #1) now shows, in the browser and in the export:

- **No product, no purchase.** A pipe with no selected product is described by what the source asks for (nominal size as printed, the material requirement and where it is stated) and the pieces it models. Its purchase quantity is unknown, not "1 each".
- **No invented procedure.** Such a piece gets one step, "Detail cutting and end preparation once its product and connection are selected", instead of CPVC cutting, bevelling and cement steps. The cure-plan question and the joint-movement and cure inputs are asked only when the run uses the solvent-cement catalog.
- **Projected length.** The cut list shows the projected centerline (3047.6613 mm for FS-01 P27) with the cut left unknown and each reason on its own line: tie-in offset, product, endpoint datum, and that a traced length is a plan projection.
- **Retained context.** Heads and adjacent pipe outside the scope are listed with their sheet labels (H1, H3, P30, P28). They are not detailed, connected or purchased. The export PDF has a Retained context table and the BOM CSV has `retained_context` rows with status `not_purchased`.
- **Cut CSV.** A `centerline_length` column is appended (same unit as `cut_length`).
- **Rules that apply.** A jurisdiction other than San Francisco can be chosen; the San Francisco rule packs are then not run and the checks say no rule pack covers the project. Retained context heads get no head-product check, and the assembly check cites the CPVC procedure only when a step uses it.

![Materials for FS-01 P27 with no product selected](ui/prep-materials.png) ![Retained context](ui/prep-context.png) ![Assembly without invented steps](ui/prep-assembly.png)

## Checks

```
pnpm test        # API / integration tests and internal fault-injection tests
pnpm typecheck
pnpm build
```

Browser pass: both workflows were run end to end against `pnpm start` at 1600×1000 and 390×844. Screenshots are in `docs/ui/`.

### Unified UI migration verification

- All 24 test files pass (643 tests passed, 9 skipped); workspace typecheck and production build pass.
- Local browser with an isolated data directory: created an inspection, loaded synthetic observations, edited and saved a fact, created and answered a request with stored evidence, generated a report, and invoked JSON download. The download success state appeared; the browser harness did not return a saved-file event.
- Reloading `/legacy` redirects to `/inspections` and shows the saved inspection with its current revision.
- Drawing preparation generated materials and cuts. Site adaptation generated alternatives, selected Route A, built the revised package, and generated PDF/CSV artifacts through the existing server.
- Desktop (1440 px) and phone (390 px) inspection views checked visually. Phone package panels no longer overlap the canvas; page width stays within 390 px. No browser console errors were reported in the checked session.
- Screenshots: `docs/ui/35-integrated-inspections.png` and `docs/ui/36-inspections-mobile.png`.

### Main drawing-editor integration

- Merged the source-based SVG editor into Field inspections without restoring the legacy shell or stylesheet. New inspections retain the reference drawing / sample selection. The work-package run editor remains a separate workflow with the limitations above.
- All 26 test files pass (660 passed, 9 skipped); workspace typecheck and production build pass.
- Browser check against isolated local data: created an FS-01 reference inspection, changed H1 orientation, saved drawing revision 2, and reloaded to verify the saved orientation in the unified UI.

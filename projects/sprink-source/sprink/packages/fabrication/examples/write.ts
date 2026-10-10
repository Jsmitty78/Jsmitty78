import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { compareWorkPackages, deriveWorkPackage, spearsCatalog } from "../src/index.js";
import { adaptationExample, drawingExample } from "./fixtures.js";
const baseline = drawingExample(), candidate = adaptationExample();
const catalog = spearsCatalog(baseline.configVersion);
const drawingOutput = deriveWorkPackage(baseline, catalog), adaptationOutput = deriveWorkPackage(candidate, catalog);
for (const [name, value] of Object.entries({ "drawing-input": baseline, "drawing-output": drawingOutput,
  "adaptation-input": candidate, "adaptation-output": adaptationOutput, "delta": compareWorkPackages(drawingOutput, adaptationOutput) })) {
  writeFileSync(fileURLToPath(new URL(`./${name}.json`, import.meta.url)), `${JSON.stringify(value, null, 2)}\n`);
}

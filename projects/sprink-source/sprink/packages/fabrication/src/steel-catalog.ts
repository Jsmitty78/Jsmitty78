import { spearsCatalog } from "./catalog.js";
import type { Catalog } from "./types.js";

export const STEEL_PIPE_SOURCE = "wheatland-a53-sch40";
export const STEEL_ELBOW_SOURCE = "anvil-351";
/** Internal catalog keys identify family, finish and nominal size, not purchase SKUs. */
export const STEEL_PAIRS = [
  { pipeId: "wheatland/a53-sch40-black-nps2", elbowId: "anvil/351-black-nps2", size: "NPS 2", odIn: 2.375, faceIn: 2.25 },
  { pipeId: "wheatland/a53-sch40-black-nps1", elbowId: "anvil/351-black-nps1", size: "NPS 1", odIn: 1.315, faceIn: 1.5 },
] as const;

export function steelCatalog(configVersion: string): Catalog {
  return {
    configVersion, evidenceClass: "manufacturer_document",
    sources: [
      { id: STEEL_PIPE_SOURCE, document: "Wheatland A53 Schedule 40 Fire Sprinkler Pipe", revision: "WFS-101025",
        pages: "1: dimensions, suitability for threading, UL/FM manufacturer claims",
        url: "https://www.wheatland.com/wp-content/uploads/2017/12/ASTM-A53-Schedule-40-Submittal-Sheet-1.pdf",
        sha256: "e3d219e6d5633879f14cedc840d00bbf8e05a34d83790b27c74aeea7b4f7a60e" },
      { id: STEEL_ELBOW_SOURCE, document: "Anvil Fig.351 Class 125 cast iron threaded 90-degree elbow", revision: "PS-SUB-351-v01 20211022",
        pages: "1-2: material/thread standards and rating; 3: B center-to-face; 4: assembly",
        url: "https://www.asc-es.com/resources-and-downloads/351-90-elbow-straight-submittal",
        sha256: "975d5ecb359fcaec502ab2ec8bf4633c07a2298bb4463f93c9fd8fcdb6b06185" },
    ],
    products: STEEL_PAIRS.flatMap(pair => [
      { id: pair.pipeId, kind: "pipe" as const, label: `Wheatland A53 Schedule 40 black steel ${pair.size}`,
        nominalSize: pair.size, outsideDiameter: { value: pair.odIn, unit: "in" as const },
        connection: "steel_threaded" as const, preparation: "steel_threaded" as const, sourceIds: [STEEL_PIPE_SOURCE],
        limitations: ["Pipe threading suitability is documented; actual NPT end preparation and project suitability need confirmation."] },
      { id: pair.elbowId, kind: "elbow_90" as const, label: `Anvil Fig.351 Class 125 black cast iron ${pair.size}`,
        nominalSize: pair.size, connection: "steel_threaded" as const, compatiblePipeIds: [pair.pipeId],
        centerToFace: { value: pair.faceIn, unit: "in" as const }, centerToSocketBottom: null,
        publishedDimensionTolerance: null, procedureId: "anvil-351-threaded" as const, sourceIds: [STEEL_ELBOW_SOURCE],
        limitations: ["Dimensional pair requires ASME B1.20.1 prepared pipe threads; compatibility does not establish project approval.",
          "Exact fitting listing limitations and project pressure/service suitability remain unresolved; obtain applicable submittal approval."] },
    ]),
  };
}

/** Available choices only. No product is selected on behalf of a drawing. */
export function fabricationCatalog(configVersion: string): Catalog {
  const cpvc = spearsCatalog(configVersion), steel = steelCatalog(configVersion);
  return { ...cpvc, products: [...cpvc.products, ...steel.products], sources: [...cpvc.sources, ...steel.sources] };
}

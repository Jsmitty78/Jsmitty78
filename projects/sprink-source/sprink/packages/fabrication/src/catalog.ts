import type { Catalog } from "./types.js";
export const PIPE_ID = "spears/CP-010";
export const ELBOW_ID = "spears/4206-010S";
export const CEMENT_ID = "spears/FS-5";
export const DIMENSIONS_SOURCE = "spears-fg-dimensions";
export const ELBOW_SOURCE = "spears-fg90s";
export const PROCEDURE_SOURCE = "spears-fg3";
/** Pass the deployed aggregate configVersion; do not create a second catalog version. */
export function spearsCatalog(configVersion: string): Catalog {
  return {
    configVersion, evidenceClass: "manufacturer_document",
    products: [
      { id: PIPE_ID, kind: "pipe", label: "Spears FlameGuard CP-010 SDR 13.5 plain-end pipe",
        nominalSize: "NPS 1", outsideDiameter: { value: 1.315, unit: "in" },
        connection: "cpvc_socket_solvent", preparation: "spears-fg3", sourceIds: [DIMENSIONS_SOURCE, PROCEDURE_SOURCE] },
      { id: ELBOW_ID, kind: "elbow_90", label: "Spears FlameGuard 4206-010S sweep 90 socket x socket",
        nominalSize: "NPS 1", connection: "cpvc_socket_solvent", procedureId: "spears-fg3-socket-1in", compatiblePipeIds: [PIPE_ID],
        centerToFace: { value: 2.375, unit: "in" }, centerToSocketBottom: { value: 1.3125, unit: "in" },
        publishedDimensionTolerance: { value: 0.03125, unit: "in" },
        sourceIds: [ELBOW_SOURCE, DIMENSIONS_SOURCE, PROCEDURE_SOURCE] },
    ],
    sources: [
      { id: DIMENSIONS_SOURCE, document: "FlameGuard Technical: General Information", revision: "undated; retrieved 2026-09-26",
        pages: "PDF 1, printed 5: dimension reference and CP-010 row",
        url: "https://parts.spearsmfg.com/sourcebook/FGTECH_FG-1_T_FGGI_T.pdf",
        sha256: "bd8804bfa4c2e94f062ee7a21e8d162b41ec5544d258216c5b051a7856c37cab" },
      { id: ELBOW_SOURCE, document: "FlameGuard CPVC Sweep 90 Elbows", revision: "FG90S-2-0723; printed 08/24",
        pages: "PDF 1-2; 4206-010S row and G/H drawing on 2",
        url: "https://www.spearsmfg.com/flameguard/027-FG90S-2-0723_0824_web.pdf",
        sha256: "919dec69092bd8a371731ec21b22ec1503de703baad54a9142761999c18dc327" },
      { id: PROCEDURE_SOURCE, document: "FlameGuard CPVC Fire Sprinkler Products Installation Instructions",
        revision: "FG-3-1223, December 20, 2023 (URL retains 0321)",
        pages: "24-28: socket procedure; 39-40: cut-in conditions; 42: pipe dimensions",
        url: "https://www.spearsmfg.com/flameguard/03-FG-3_0321_web.pdf",
        sha256: "ee2db4064f2d51d556d91f484e44f789b1b128812a2feefbd46dca99c8e0697c" },
    ],
  };
}

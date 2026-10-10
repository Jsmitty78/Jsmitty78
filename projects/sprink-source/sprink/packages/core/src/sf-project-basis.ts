import { Type } from "typebox";
import { contextIssues, factIssues } from "./evidence.js";
import { factSchema } from "./schemas.js";
import type { Fact, RuleContext } from "./types.js";

export type SfCodeCycle = "2019" | "2022" | "2025" | "other";
export type SfNfpa13Edition = "2016" | "2022" | "2025";
export interface SfProjectFacts {
  jurisdiction: Fact<"san_francisco" | "other">;
  standard: Fact<"nfpa13" | "nfpa13r" | "nfpa13d" | "other">;
  permitKind: Fact<"new_building_site_permit" | "revision" | "as_built" | "other">;
  sitePermitCodeCycle?: Fact<SfCodeCycle>;
  architecturalPermitCodeCycle?: Fact<SfCodeCycle>;
  editionElection?: Fact<"permit_basis" | "owner_newer">;
  ownerRequestedEdition?: Fact<SfNfpa13Edition | "other">;
  originalFirePermitNumber?: Fact<string>;
  originalNfpa13Edition?: Fact<SfNfpa13Edition | "other">;
}

const options = <T extends string>(values: readonly T[]) => Type.Union(values.map(value => Type.Literal(value)));
const jurisdictions = ["san_francisco", "other"] as const;
const standards = ["nfpa13", "nfpa13r", "nfpa13d", "other"] as const;
const permitKinds = ["new_building_site_permit", "revision", "as_built", "other"] as const;
const codeCycles = ["2019", "2022", "2025", "other"] as const;
const editions = ["2016", "2022", "2025", "other"] as const;
const elections = ["permit_basis", "owner_newer"] as const;

export const SfProjectFactsSchema = Type.Object({
  jurisdiction: factSchema(options(jurisdictions)),
  standard: factSchema(options(standards)),
  permitKind: factSchema(options(permitKinds)),
  sitePermitCodeCycle: Type.Optional(factSchema(options(codeCycles))),
  architecturalPermitCodeCycle: Type.Optional(factSchema(options(codeCycles))),
  editionElection: Type.Optional(factSchema(options(elections))),
  ownerRequestedEdition: Type.Optional(factSchema(options(editions))),
  originalFirePermitNumber: Type.Optional(factSchema(Type.String())),
  originalNfpa13Edition: Type.Optional(factSchema(options(editions))),
}, { additionalProperties: false });

export const SF_PROJECT_BASIS_SOURCE = Object.freeze({
  document: "SFFD Administrative Bulletin 2.04, Fire Sprinkler Submittals",
  revision: "2025",
  page: 1,
  url: "https://sf-fire.org/media/4169",
  purpose: "Notes 1.A-C: NFPA 13 edition basis for FIRE Only permits under a new-building site-permit schedule, voluntary owner elections, and original-permit editions for revisions/as-builts.",
  checkedAt: "2026-09-26",
});

export interface SfProjectBasisResult {
  status: "resolved" | "unknown" | "not_applicable";
  nfpa13Edition: SfNfpa13Edition | null;
  reason: string;
  missingInputs: string[];
  sourceRefs: readonly (typeof SF_PROJECT_BASIS_SOURCE)[];
  taskRevision: number;
  targetId: string;
}

function inputIssues(facts: SfProjectFacts, key: keyof SfProjectFacts, values: readonly string[], ctx: RuleContext): string[] {
  const fact = facts[key];
  return [...factIssues(fact, ctx, key), ...(!values.includes(fact?.value ?? "") ? [key] : [])];
}

/** Selects a bounded project edition basis, never a sprinkler-compliance result or a task default. */
export function resolveSfNfpa13Edition(facts: SfProjectFacts, ctx: RuleContext): SfProjectBasisResult {
  const finish = (status: SfProjectBasisResult["status"], reason: string, missingInputs: string[] = [], nfpa13Edition: SfNfpa13Edition | null = null): SfProjectBasisResult => ({
    status, nfpa13Edition, reason, missingInputs: [...new Set(missingInputs)],
    sourceRefs: [SF_PROJECT_BASIS_SOURCE], taskRevision: ctx.taskRevision, targetId: ctx.targetId,
  });
  const unknown = (reason: string, missing: string[]) => finish("unknown", reason, missing);
  const invalid = contextIssues(ctx);
  if (invalid.length) return unknown("The target, task revision, or evidence context is invalid.", invalid);
  const jurisdictionMissing = inputIssues(facts, "jurisdiction", jurisdictions, ctx);
  const standardMissing = inputIssues(facts, "standard", standards, ctx);
  const permitMissing = inputIssues(facts, "permitKind", permitKinds, ctx);
  if (!jurisdictionMissing.length && facts.jurisdiction.value === "other") return finish("not_applicable", "The independently confirmed jurisdiction is outside San Francisco.");
  if (!standardMissing.length && facts.standard.value !== "nfpa13") return finish("not_applicable", "This edition resolver is limited to NFPA 13; NFPA 13R, NFPA 13D, and other standards are not resolved.");
  if (!permitMissing.length && facts.permitKind.value === "other") return finish("not_applicable", "The confirmed permit kind is outside the adopted site-permit, FIRE Only revision, and as-built pathways.");
  const applicabilityMissing = [...jurisdictionMissing, ...standardMissing, ...permitMissing];
  if (applicabilityMissing.length) return unknown("Jurisdiction, standard, and permit pathway require independent confirmation with current evidence.", applicabilityMissing);

  if (facts.permitKind.value === "revision" || facts.permitKind.value === "as_built") {
    const originalEditionMissing = inputIssues(facts, "originalNfpa13Edition", editions, ctx);
    if (facts.originalNfpa13Edition?.value === "other") originalEditionMissing.push("originalNfpa13Edition");
    const permitNumberMissing = factIssues(facts.originalFirePermitNumber, ctx, "originalFirePermitNumber");
    const number = facts.originalFirePermitNumber?.value;
    if (typeof number !== "string" || !number.trim() || ["UNKNOWN", "AMBIGUOUS", "UNREADABLE"].includes(number.trim().toUpperCase())) permitNumberMissing.push("originalFirePermitNumber");
    const missing = [...originalEditionMissing, ...permitNumberMissing];
    // No new-edition election is needed when retaining the original permit edition.
    // Any supplied election or requested edition must still be independently established.
    if (facts.editionElection?.value != null) {
      missing.push(...inputIssues(facts, "editionElection", elections, ctx));
      if (facts.editionElection.value !== "permit_basis") missing.push("editionElection");
    }
    if (facts.ownerRequestedEdition?.value != null) {
      missing.push(...inputIssues(facts, "ownerRequestedEdition", editions, ctx));
      if (facts.ownerRequestedEdition.value !== facts.originalNfpa13Edition?.value) missing.push("ownerRequestedEdition");
    }
    if (missing.length) return unknown("FIRE Only revisions/as-builts must retain the original issued permit's edition and reference its permit number; missing evidence or a new-edition request is unresolved.", missing);
    return finish("resolved", `Retain NFPA 13 ${facts.originalNfpa13Edition!.value} from the independently confirmed original FIRE Only permit ${number!.trim()}. This selects an edition basis only.`, [], facts.originalNfpa13Edition!.value as SfNfpa13Edition);
  }

  const siteMissing = inputIssues(facts, "sitePermitCodeCycle", codeCycles, ctx);
  const architecturalMissing = inputIssues(facts, "architecturalPermitCodeCycle", codeCycles, ctx);
  if (facts.sitePermitCodeCycle?.value === "other") siteMissing.push("sitePermitCodeCycle");
  if (facts.architecturalPermitCodeCycle?.value === "other") architecturalMissing.push("architecturalPermitCodeCycle");
  const electionMissing = inputIssues(facts, "editionElection", elections, ctx);
  const missing = [...siteMissing, ...architecturalMissing, ...electionMissing];
  if (missing.length) return unknown("A new-building site-permit pathway needs confirmed site and architectural code cycles and the owner's edition election.", missing);
  if (facts.sitePermitCodeCycle!.value !== facts.architecturalPermitCodeCycle!.value) return unknown("The site and architectural permit code cycles differ; this bounded resolver does not choose between them.", ["sitePermitCodeCycle", "architecturalPermitCodeCycle"]);
  const baseEdition = ({ "2019": "2016", "2022": "2022", "2025": "2025" } as const)[facts.sitePermitCodeCycle!.value as "2019" | "2022" | "2025"];
  if (facts.editionElection!.value === "permit_basis") {
    if (facts.ownerRequestedEdition?.value != null) {
      const requestedMissing = inputIssues(facts, "ownerRequestedEdition", editions, ctx);
      if (facts.ownerRequestedEdition.value !== baseEdition) requestedMissing.push("editionElection", "ownerRequestedEdition");
      if (requestedMissing.length) return unknown("A supplied owner-requested edition lacks independent evidence or conflicts with the selected permit basis; resolve the election explicitly.", requestedMissing);
    }
    return finish("resolved", `The confirmed site and architectural permit code cycle ${facts.sitePermitCodeCycle!.value} maps to NFPA 13 ${baseEdition} under AB 2.04 Note 1.A. This selects an edition basis only.`, [], baseEdition);
  }
  const requestedMissing = inputIssues(facts, "ownerRequestedEdition", editions, ctx);
  const requested = facts.ownerRequestedEdition?.value;
  if (requested !== "2022" && requested !== "2025") requestedMissing.push("ownerRequestedEdition");
  if (requestedMissing.length) return unknown("The voluntary newer-edition pathway requires an independently confirmed owner request for a supported newer edition.", requestedMissing);
  if (Number(requested) <= Number(baseEdition)) return unknown("The requested edition is not newer than the confirmed permit basis; the election must be resolved explicitly.", ["editionElection", "ownerRequestedEdition"]);
  return finish("resolved", `The independently confirmed owner election selects NFPA 13 ${requested} instead of the ${baseEdition} permit basis under AB 2.04 Note 1.B. This selects an edition basis only.`, [], requested as SfNfpa13Edition);
}

import {
  executeProjectRule,
  type WorkPackageSnapshot,
  type ProjectEvaluationOutput,
  type ProjectRuleExecutionOutput,
  type ProjectQuantity,
  type Fact,
  type ProjectEvaluationRequest,
  type ProjectLocalPlan,
  type ProjectLocalChangeInput,
  type ProjectEvidence,
} from "@sprink/core";
import type {
  FabricationOutput,
  FabricationInput,
} from "@sprink/fabrication";
import type { Plan } from "@sprink/planning";
import { fact, known, unknown, savedFact } from "./model.js";
export interface CheckResult {
  id: string;
  subjectIds: string[];
  status: "pass" | "fail" | "unknown" | "not_applicable";
  state: string;
  reason: string;
  sourceRefs: string[];
}
export interface ProfileOutput {
  profile: "drawing_preparation" | "site_adaptation";
  required: { id: string; subjectIds: string[] }[];
  checks: CheckResult[];
  excluded: { id: string; reason: string }[];
  project: ProjectEvaluationOutput & Partial<Pick<ProjectRuleExecutionOutput, "requiredArtifacts">>;
}
function buildProfile(
  s: WorkPackageSnapshot,
  input: FabricationInput,
  output: FabricationOutput,
  plan: Plan,
  baseline: Plan,
  ruleId?: string,
): ProfileOutput {
  const adaptation = s.intent === "adapt_to_site" && plan.id !== baseline.id;
  const profile = !adaptation ? "drawing_preparation" : "site_adaptation";
  // Retained context (outside the scope) is shown, never checked as part of the work.
  const context = new Set(s.scope?.excludedEntityIds ?? []);
  const heads = s.baselinePlan!.entities.filter(
    (e) => e.kind === "head" && !context.has(e.id),
  );
  const supports = s.baselinePlan!.entities.filter((e) => e.kind === "support" && !context.has(e.id));
  const quantity = (field: string, subject: string): Fact<ProjectQuantity> => {
    const v = fact<number>(s, field, subject), unit = savedFact(s, field, subject)?.unit;
    const valid = typeof v.value === "number" && Number.isFinite(v.value) && ["m","ft","in","Pa","kPa","bar","psi","N_m","ft_lb"].includes(unit ?? "");
    return {...v, value: valid ? {value:v.value!,unit:unit as ProjectQuantity["unit"]} as ProjectQuantity : null, confirmed: valid && v.confirmed};
  };
  const temperature = (subject: string): Fact<{value:number;unit:"F"|"C"}> => {
    const v = fact<number>(s,"manufacturerTemperatureRating",subject), unit = savedFact(s,"manufacturerTemperatureRating",subject)?.unit;
    const valid = typeof v.value === "number" && Number.isFinite(v.value) && (unit === "F" || unit === "C");
    return {...v,value:valid ? {value:v.value!,unit:unit as "F"|"C"} : null,confirmed:valid && v.confirmed};
  };
  const request: ProjectEvaluationRequest = {
    project: {
      id: s.projectId,
      revision: s.inputRevision,
      asOf: s.updatedAt.slice(0, 10),
    },
    // Selection belongs to JEV; scripts retain their own applicability validation.
    selectedRulePacks: [],
    facts: {
      sfNfpa13: {
        jurisdiction: fact(s, "jurisdiction"),
        standard: fact(s, "standard"),
        permitKind: fact(s, "permitKind"),
        originalNfpa13Edition: fact(s, "originalNfpa13Edition"),
        originalFirePermitNumber: fact(s, "originalFirePermitNumber"),
      },
      systemType: fact(s, "systemType"),
      sprinklerType: fact(s, "sprinklerType"),
      storage: fact(s, "storage"),
    },
    heads: heads.map((h) => ({ id: h.id, facts: {
      model: fact(s,"model",h.id), installation: fact(s,"installation",h.id), mounting: fact(s,"mounting",h.id),
      orientation: fact(s,"orientation",h.id), verticalReference: fact(s,"verticalReference",h.id),
      escutcheon: fact(s,"escutcheon",h.id), bulbCondition: fact(s,"bulbCondition",h.id),
      installationWrench: fact(s,"installationWrench",h.id), threadStandard: fact(s,"threadStandard",h.id),
      construction: fact(s,"construction",h.id), fieldFinish: fact(s,"fieldFinish",h.id), leakage: fact(s,"leakage",h.id),
      corrosion: fact(s,"corrosion",h.id), approvalBasis: fact(s,"approvalBasis",h.id), pressureBasis: fact(s,"pressureBasis",h.id),
      installationTorque: quantity("installationTorque",h.id), workingPressure: quantity("workingPressure",h.id),
    }, manufacturerExtra: {
      installationWrenchEngagementArea: fact(s,"installationWrenchEngagementArea",h.id),
      pipeThreadSealantAppliedBeforeHandTightening: fact(s,"pipeThreadSealantAppliedBeforeHandTightening",h.id),
      headHandTightenedBeforeWrenchTightening: fact(s,"headHandTightenedBeforeWrenchTightening",h.id),
      mountingPlateInstalledBeforeHandTightening: fact(s,"mountingPlateInstalledBeforeHandTightening",h.id),
      manufacturerTemperatureRating: temperature(h.id), manufacturerListedAgency: fact(s,"manufacturerListedAgency",h.id),
      sprinklerBodyFinish: fact(s,"sprinklerBodyFinish",h.id), sprinklerSalesHemisphere: fact(s,"sprinklerSalesHemisphere",h.id),
    } })),
    supports: supports.map((h) => ({ id: h.id, facts: {
      use: fact(s,"use",h.id), fastenerType: fact(s,"fastenerType",h.id), substrate: fact(s,"substrate",h.id),
      installationState: fact(s,"installationState",h.id), pipeMovedOrAltered: fact(s,"pipeMovedOrAltered",h.id),
      hangerHoldsProperly: fact(s,"hangerHoldsProperly",h.id), crackedConcreteQualification: fact(s,"crackedConcreteQualification",h.id),
    } })),
    evidence: [],
  };
  const drawing = {
    documentId: s.sourceDrawing!.drawingId,
    revision: s.sourceDrawing!.revision,
  };
  const localPlan = (p: Plan): ProjectLocalPlan => ({
    ...p,
    sourceDrawing:
      p.id === baseline.id
        ? known(drawing, [`drawing-${s.sourceDrawing!.assetId}`])
        : unknown(),
    rooms: [],
    heads: [],
    supports: supports.map((h) => ({
      supportId: h.id,
      attachedPipeSegmentIds: unknown(),
    })),
    segments: p.segments.map(({ productId, sourceSegmentIds, ...x }) => ({
      ...x,
      nominalSize: unknown(),
      material: unknown(),
      pressureRating: unknown(),
      connectionAtStart: unknown(),
      connectionAtEnd: unknown(),
    })),
    fittings: p.fittings.map((x) => ({
      ...x,
      productId: unknown(),
      nominalSize: unknown(),
      material: unknown(),
      pressureRating: unknown(),
      ports: [
        { ...x.ports[0], connection: unknown() },
        { ...x.ports[1], connection: unknown() },
      ],
    })),
  });
  if (adaptation) {
    const change: ProjectLocalChangeInput = {
      id: `local-${s.changeRequest!.id}`,
      approvedDrawing: {
        document: known(drawing, [`drawing-${s.sourceDrawing!.assetId}`]),
        approval:
          s.sourceDrawing!.approval === "approved"
            ? known("approved", [`drawing-${s.sourceDrawing!.assetId}`])
            : unknown(),
      },
      baseline: localPlan(baseline),
      proposed: localPlan(plan),
      changeRequest: {
        id: s.changeRequest!.id,
        description: known(s.changeRequest!.description),
        affectedEntityIds: known(s.changeRequest!.affectedEntityIds),
        impactNeighborhood: unknown(),
        changeClassification: fact(s, "changeClassification"),
        systemWorkType: fact(s, "systemWorkType"),
        existingSystem: fact(s, "existingSystem"),
        addsSprinklersOrPiping: fact(s, "addsSprinklersOrPiping"),
        remoteAreaChanged: fact(s, "remoteAreaChanged"),
        hazardBecameMoreDemanding: fact(s, "hazardBecameMoreDemanding"),
        waterSupplyRoutingOrBackflowChanged: fact(
          s,
          "waterSupplyRoutingOrBackflowChanged",
        ),
        headRemovalActions: [],
      },
    };
    request.localChange = change;
  }
  // The rule adapter preserves evidence scope. It never widens a user fact onto another part.
  request.evidence = input.evidence.map(
    (e) =>
      ({
        id: e.id,
        projectId: s.projectId,
        subjectIds: [
          ...e.subjectIds,
          ...(e.id.startsWith("drawing-")
            ? [
                baseline.id,
                ...baseline.segments.map((x) => x.id),
                ...baseline.fittings.map((x) => x.id),
              ]
            : []),
        ],
        kind: "drawing",
        documentRevision: drawing,
      }) satisfies ProjectEvidence,
  );
  for (const f of [...s.detailing, ...s.siteFacts].filter(
    (f) => f.subjectIds.length === 0,
  )) {
    const e = request.evidence.find((e) => e.id === f.id);
    if (e) e.subjectIds.push(s.projectId);
  }
  const project: ProfileOutput["project"] = ruleId ? executeProjectRule(request, ruleId) : {
    projectId:s.projectId, taskRevision:s.inputRevision, asOf:request.project.asOf,
    rules:[], coverage:[], missingInputs:[],
  };
  // Intake requirements can be package-wide or scoped. Never borrow another entity's facts.
  const requirement = (field: string, subject: string) => {
    const scoped = fact<string | number | boolean>(s, field, subject);
    return scoped.evidenceIds.length ? scoped : fact<string | number | boolean>(s, field);
  };
  const sourceFields = ["requiredConnectionMethod", "requiredPipeSpecification", "materialRequirement", "materialRequirement.material", "nominalSize"];
  const nominal = (value: string | number | boolean | null) => {
    if (typeof value !== "string") return null;
    const text = value.trim().toLowerCase().replace(/^nps\s*/, "").replace(/\s*(?:inch(?:es)?|in|["″])$/, "").trim();
    if (!text) return null;
    if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
    const fraction = text.match(/^(?:(\d+)[ -]+)?(\d+)\/(\d+)$/);
    if (!fraction || Number(fraction[3]) === 0) return null;
    return Number(fraction[1] ?? 0) + Number(fraction[2]) / Number(fraction[3]);
  };
  const checks: CheckResult[] = [
    ...(project.basis ? [{
      id: "N01_SF_EDITION_BASIS",
      subjectIds: [project.basis.targetId],
      status: project.basis.status === "resolved" ? "pass" as const : project.basis.status,
      state: project.basis.status === "resolved" ? "verified" : project.basis.status === "unknown" ? "input_missing" : "not_applicable",
      reason: project.basis.reason + (project.basis.missingInputs.length ? ` Missing inputs: ${project.basis.missingInputs.join(", ")}.` : ""),
      sourceRefs: project.basis.sourceRefs.map(r => r.url),
    }] : []),
    ...output.selectedProducts.filter(p => p.limitations?.length).map(p => ({
      id: `PRODUCT-SUITABILITY-${p.id}`, subjectIds: input.pieces.filter(x => x.productId === p.id).map(x => x.id),
      status: "unknown" as const, state: "input_missing", reason: p.limitations!.join(" "), sourceRefs: p.sourceIds,
    })),
    ...input.pieces.flatMap(p => sourceFields.flatMap(field => {
      const req = requirement(field, p.id);
      return req.value !== null ? [{
        id: `SOURCE-REQUIREMENT-${p.id}-${field}`, subjectIds: [p.id], status: "unknown" as const,
        state: typeof req.value === "string" ? "review_required" : "invalid_input",
        reason: typeof req.value === "string"
          ? `Source ${field}: ${req.value} (${req.confirmed ? "confirmed source input" : "unconfirmed source input"}). Selection and project suitability require independent review.`
          : `Source ${field}: ${String(req.value)} is not text. Correct the source requirement before checking product compatibility.`,
        sourceRefs: req.evidenceIds,
      }] : [];
    })),
    ...input.pieces.flatMap(p => {
      const connection = requirement("requiredConnectionMethod", p.id);
      const material = requirement("materialRequirement.material", p.id);
      const size = requirement("nominalSize", p.id);
      const product = output.selectedProducts.find(x => x.id === p.productId);
      if (!product) return [];
      const productMaterial = product.connection === "steel_threaded" ? "steel" : product.connection === "cpvc_socket_solvent" ? "cpvc" : null;
      const conflictRefs = [
        ...(connection.confirmed && typeof connection.value === "string" && connection.value && connection.value !== product.connection ? connection.evidenceIds : []),
        ...(material.confirmed && typeof material.value === "string" && ["steel", "cpvc", "copper"].includes(material.value.toLowerCase()) && productMaterial && material.value.toLowerCase() !== productMaterial ? material.evidenceIds : []),
      ];
      const requiredSize = nominal(size.value), selectedSize = nominal(product.nominalSize);
      return [
        ...(conflictRefs.length ? [{
          id: `MATERIAL-CONFLICT-${p.id}`, subjectIds: [p.id], status: "fail" as const, state: "conflict",
          reason: `Selected ${product.id} (${productMaterial ?? product.connection}) conflicts with the explicit source material or connection requirement; document a design change before using it.`,
          sourceRefs: [...new Set(conflictRefs)],
        }] : []),
        ...(size.confirmed && requiredSize !== null && selectedSize !== null && requiredSize !== selectedSize ? [{
          id: `NOMINAL-SIZE-CONFLICT-${p.id}`, subjectIds: [p.id], status: "fail" as const, state: "conflict",
          reason: `Source nominal size ${size.value} differs from selected product ${product.nominalSize}. Resolve the selection or source requirement before using it.`,
          sourceRefs: size.evidenceIds,
        }] : []),
      ];
    }),
    ...output.cuts.map((c) => ({
      id: `CUT-${c.pieceId}`,
      subjectIds: [c.pieceId],
      status:
        c.cutLength.value === null ? ("unknown" as const) : ("pass" as const),
      state: c.cutLength.value === null ? "input_missing" : "verified",
      reason:
        c.cutLength.value === null
          ? c.cutLength.reasons.join("; ")
          : `Bounded cut arithmetic (${c.cutLength.basis}); not installation approval`,
      sourceRefs: c.takeouts.flatMap((t) => t.sourceIds),
    })),
    {
      id: "ASSEMBLY_CONDITIONS",
      subjectIds: input.pieces.map((p) => p.id),
      status: output.operations.every((o) => o.status === "planned")
        ? "pass"
        : "unknown",
      state: output.operations.some((o) => o.status === "unsupported")
        ? "unsupported"
        : output.operations.some((o) => o.status !== "planned")
          ? "input_missing"
          : "verified",
      reason: output.operations.every((o) => o.status === "planned")
        ? "Supported procedure with supplied access, movement and cure confirmations"
        : "Assembly has unresolved method-specific conditions, geometry or fixed-end closure",
      sourceRefs: output.sources.map((r) => r.id),
    },
    ...project.rules.map((r) => ({
      id: r.ruleId,
      subjectIds: r.subjectIds,
      status: r.status,
      state:
        r.verificationState ??
        (r.status === "unknown" ? "input_missing" : "verified"),
      reason: r.reason,
      sourceRefs: r.sourceRefs.map((x) => x.url),
    })),
    ...(project.requiredArtifacts ?? []).map(a => ({
      id: `DELIVERABLE-${a.id}`, subjectIds:a.subjectIds,
      status: a.state === "not_triggered" ? "not_applicable" as const : "unknown" as const,
      state:a.state, reason:`${a.title}: ${a.reason}`, sourceRefs:a.sourceRefs.map(r=>r.url),
    })),
    ...project.coverage
      .filter(
        (c) => c.state !== "supported",
      )
      .map((c) => ({
        id: `COVERAGE-${c.id}`,
        subjectIds: [],
        status: "unknown" as const,
        state: c.state,
        reason: c.selected ? c.reason : `Catalog limitation; applicability not established; not executed. ${c.reason}`,
        sourceRefs: c.sourceRefs.map((r) => r.url),
      })),
    {
      id: "SUBJECT_SCOPE",
      subjectIds: [],
      status: "unknown",
      state: "input_missing",
      reason:
        "Full sprinkler, support and impact-neighborhood completeness requires project review; an empty enumeration is not a passing check.",
      sourceRefs: [],
    },
    ...heads
      .filter((h) => h.productId !== "TY3231")
      .map((h) => ({
        id: `HEAD-PRODUCT-${h.id}`,
        subjectIds: [h.id],
        status: "unknown" as const,
        state: "unsupported",
        reason: "Selected head product has no executable manufacturer pack",
        sourceRefs: [],
      })),
  ];
  // A rule can return separate findings for several heads; exported findings need stable identities.
  const counts = new Map<string, number>();
  for (const c of checks) counts.set(c.id, (counts.get(c.id) ?? 0) + 1);
  for (const c of checks) if (counts.get(c.id)! > 1) c.id = `${c.id}-${c.subjectIds.join("-")}`;
  return {
    profile,
    required: checks.map((c) => ({ id: c.id, subjectIds: c.subjectIds })),
    checks,
    project,
    excluded: [],
  };
}

/** Execute only the rule selected by JEV, preserving fabrication limitations alongside its findings. */
export function evaluateProfile(s: WorkPackageSnapshot, input: FabricationInput, output: FabricationOutput, plan: Plan, baseline: Plan, ruleId: string): ProfileOutput {
  return buildProfile(s,input,output,plan,baseline,ruleId);
}
/** Fabrication arithmetic and source compatibility only; does not select or execute sprinkler rules. */
export function deriveFabricationProfile(s: WorkPackageSnapshot, input: FabricationInput, output: FabricationOutput, plan: Plan, baseline: Plan): ProfileOutput {
  return buildProfile(s,input,output,plan,baseline);
}

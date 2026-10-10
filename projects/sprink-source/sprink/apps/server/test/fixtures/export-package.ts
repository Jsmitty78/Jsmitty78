import type { ExportBinding, ExportSnapshot, PlanView } from '../../src/exports/types.js';

/** Independent synthetic arithmetic fixture, NOT manufacturer or field evidence. */
export function exportFixture(adapt = false): ExportSnapshot {
  const binding: ExportBinding = {
    packageId: 'fixture-package', inputRevision: 7, configVersion: 'fixture-config-1', modelVersion: 'drawing-3',
    selectionId: adapt ? 'detour' : 'baseline', catalogVersion: 'synthetic-catalog-1', engineVersion: 'engine-1',
    rulesVersion: 'rules-1', evidenceVersion: 'evidence-2', outputVersion: 'outputs-7',
  };
  const baseline: PlanView = {
    id: 'baseline', title: 'Original straight run', unit: 'mm',
    segments: [{ id: 'S0', pieceIds: ['P0'], from: [0, 0, 0], to: [1200, 0, 0] }],
    joints: [{ id: 'T0', position: [0, 0, 0] }, { id: 'T1', position: [1200, 0, 0] }],
  };
  const selected: PlanView = adapt ? {
    id: 'detour', title: 'Selected synthetic detour', unit: 'mm',
    segments: [
      { id: 'S1', pieceIds: ['P1'], from: [0, 0, 0], to: [0, 200, 0] },
      { id: 'S2', pieceIds: ['P2'], from: [0, 200, 0], to: [1200, 200, 0] },
      { id: 'S3', pieceIds: ['P3'], from: [1200, 200, 0], to: [1200, 0, 0] },
    ], joints: [...baseline.joints, { id: 'E1', position: [0, 200, 0] }, { id: 'E2', position: [1200, 200, 0] }],
  } : baseline;
  const cuts = adapt ? [
    { pieceId: 'P1', segmentIds: ['S1'], jointIds: ['T0', 'E1'], length: 140 },
    { pieceId: 'P2', segmentIds: ['S2'], jointIds: ['E1', 'E2'], length: 1140 },
    { pieceId: 'P3', segmentIds: ['S3'], jointIds: ['E2', 'T1'], length: 140 },
  ] : [{ pieceId: 'P0', segmentIds: ['S0'], jointIds: ['T0', 'T1'], length: 1140 }];
  return {
    binding, derivedBinding: { ...binding }, intent: adapt ? 'adapt_to_site' : 'prepare_from_drawing',
    title: 'Sprinkler work package / synthetic example',
    scope: 'SYNTHETIC software fixture. Not manufacturer data, construction instructions, or field validation.',
    drawingReference: 'SYN-DRAW page 1 / bounded run between T0 and T1', selectedPlan: selected,
    ...(adapt ? { baselinePlan: baseline } : {}),
    materials: [
      { id: 'M-PIPE', description: 'Installed pipe centerline length (not purchasing stock)', quantity: adapt ? 1600 : 1200, unit: 'mm', status: 'known', subjectIds: selected.segments.map(r => r.id), sourceIds: ['SYN-DRAW'], unresolvedReason: null },
      { id: 'M-ELBOW', description: '90-degree fittings / synthetic count', quantity: adapt ? 2 : 0, unit: 'each', status: 'known', subjectIds: adapt ? ['E1', 'E2'] : ['S0'], sourceIds: ['SYN-DRAW'], unresolvedReason: null },
    ],
    cuts: cuts.map(r => ({ ...r, unit: 'mm', status: 'known', sourceIds: ['SYN-DRAW', 'SYN-END'], unresolvedReason: null })),
    assembly: cuts.map((r, i) => ({ id: `OP${i + 1}`, instruction: `Synthetic sequence placeholder: review ${r.pieceId} and its numbered joints against the drawing. Not an installation procedure.`, pieceIds: [r.pieceId], jointIds: r.jointIds, sourceIds: ['SYN-DRAW'], status: 'known', unresolvedReason: null })),
    changes: adapt ? [
      { id: 'D1', kind: 'removed', entityType: 'cut', subjectIds: ['P0'], before: '1140 mm', after: null, description: 'Original piece is not in selected plan.', sourceIds: ['SYN-END'] },
      { id: 'D2', kind: 'added', entityType: 'material', subjectIds: ['E1', 'E2'], before: '0 each', after: '2 each', description: 'Two added elbows.', sourceIds: ['SYN-DRAW'] },
      { id: 'D3', kind: 'retained', entityType: 'joint', subjectIds: ['T0', 'T1'], before: '2 tie-ins', after: '2 tie-ins', description: 'Preserve boundary positions.', sourceIds: ['SYN-DRAW'] },
      { id: 'D4', kind: 'proposed_reuse', entityType: 'material', subjectIds: ['P0'], before: 'Original piece', after: 'Candidate stock only', description: 'Reuse is not authorized.', sourceIds: ['SYN-DRAW'] },
      { id: 'D5', kind: 'changed', entityType: 'operation', subjectIds: ['OP1', 'OP2', 'OP3'], before: '1 operation', after: '3 operations', description: 'Synthetic sequence expands.', sourceIds: ['SYN-DRAW'] },
      { id: 'D6', kind: 'changed', entityType: 'cut', subjectIds: ['P1', 'P2', 'P3'], before: '1140 mm total', after: '1420 mm total', description: 'Independent oracle: 140 + 1140 + 140 = 1420 mm, delta +280 mm.', sourceIds: ['SYN-END'] },
    ] : [],
    findings: [], unresolvedItems: ['Synthetic fixture: actual product compatibility, assembly access and applicable regulatory checks are not verified.'],
    sources: [
      { id: 'SYN-DRAW', title: 'Synthetic coordinate fixture', reference: 'Original 1200 mm. Detour 200 + 1200 + 200 = 1600 mm. Test data only.' },
      { id: 'SYN-END', title: 'Synthetic endpoint takeout oracle', reference: 'Assumed 30 mm at each end for arithmetic testing only. Cut = centerline - 60 mm. Not a product datum.' },
    ],
  };
}

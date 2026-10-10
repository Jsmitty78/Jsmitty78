// TEST ONLY. This is not the materials engine, route generator or rule evaluator.
import type { BoundAction, DomainPort, DomainResult, ExecutionContext, Intent, OutputKind, RunRecord, RunStore, WorkSnapshot } from '../../src/contracts.js';
import { sameVersion } from '../../src/contracts.js';
export class MemoryRunStore implements RunStore {
  records = new Map<string, RunRecord>();
  get(id: string) { const run = this.records.get(id); return run && structuredClone(run); }
  save(run: RunRecord) { this.records.set(run.id, structuredClone(run)); }
  interruptRunning() {
    for (const run of this.records.values()) if (run.status === 'running') {
      run.status = 'interrupted'; run.reason = 'server_restarted';
    }
  }
}

export interface FixtureData {
  snapshot: WorkSnapshot;
  payloads: Record<string, unknown>;
}
export class FixtureDomain implements DomainPort {
  data: FixtureData;
  calls: BoundAction[] = [];
  constructor(intent: Intent = 'prepare_from_drawing') {
    this.data = {
      snapshot: { id: 'fixture-package', inputRevision: 1, configVersion: 'fixture-v1', intent,
        drawingId: 'drawing-1', baselinePlanId: 'baseline-1',
        ...(intent === 'adapt_to_site' ? { changeRequestId: 'duct-discrepancy-1' } : {}), outputs: [],
        gaps: [
          { id: 'joint_datum', description: 'Joint makeup datum is unconfirmed; dependent cut lengths remain unknown.', blocks: ['export_work_package'],
            question: { id: 'joint_datum', text: 'What is the confirmed joint makeup datum and its measurement or product source?', kind: 'fact', subjectId: 'joint-1' } },
          { id: 'assembly_access', description: 'Assembly access has not been confirmed.', blocks: ['export_work_package'],
            question: { id: 'assembly_access', text: 'Is there enough access to assemble this joint using the selected connection procedure?', kind: 'fact', subjectId: 'joint-1' } },
          { id: 'regulatory_source', description: 'Applicable regulatory source is pending; findings remain unknown.', blocks: [] },
        ] },
      payloads: {},
    };
  }
  read(id: string): WorkSnapshot {
    if (id !== this.data.snapshot.id) throw new Error('Unknown fixture package');
    return structuredClone(this.data.snapshot);
  }
  async execute(action: BoundAction, context: ExecutionContext): Promise<DomainResult> {
    context.signal.throwIfAborted();
    this.calls.push(structuredClone(action));
    const missingDatum = this.data.snapshot.gaps.some(g => g.id === 'joint_datum');
    return { summary: `Fixture ${action.operation} produced staged data for ${action.subjectId}.`, payload:
      action.operation === 'derive_work_package' ? {
        provenance: 'TEST FIXTURE, not an engineering calculation',
        materials: [{ product: 'fixture-pipe', count: 2 }],
        cuts: [{ piece: 'piece-1', lengthMm: missingDatum ? null : 1000, status: missingDatum ? 'input_missing' : 'fixture_value' }],
      } : action.operation === 'generate_change_candidates' ? { planIds: ['candidate-a', 'candidate-b'], provenance: 'Fixed fixture routes' }
        : action.operation === 'evaluate_work_package' ? { findings: [{ ruleId: action.ruleId, status: 'unknown', reason: 'source_pending' }] }
          : { provenance: 'TEST FIXTURE', operation: action.operation } };
  }
  commit(action: BoundAction, result: DomainResult, context: ExecutionContext): boolean {
    if (context.signal.aborted || !sameVersion(this.data.snapshot, context)) return false;
    {
      const kind: Partial<Record<BoundAction['operation'], OutputKind>> = {
        prepare_drawing_model: 'model', derive_work_package: 'package', generate_change_candidates: 'candidates',
        evaluate_work_package: 'evaluation', compare_candidates: 'comparison', export_work_package: 'export',
      };
      const outputKind = kind[action.operation];
      if (!outputKind) throw new Error('Unsupported fixture operation');
      const id = `${outputKind}-${context.inputRevision}-${action.subjectId}`;
      this.data.snapshot.outputs.push({ id, kind: outputKind, subjectId: action.subjectId,
        inputRevision: context.inputRevision, configVersion: context.configVersion });
      this.data.payloads[id] = structuredClone(result.payload);
    }
    return true;
  }
  /** Simulates a validated USER API mutation; never exposed as a Pi tool. */
  answer(gapIds: string[], selectedPlanId?: string) {
    if (selectedPlanId && !['candidate-a', 'candidate-b'].includes(selectedPlanId)) throw new Error('Unknown candidate');
    this.data.snapshot.gaps = this.data.snapshot.gaps.filter(g => !gapIds.includes(g.id));
    if (selectedPlanId) this.data.snapshot.selectedPlanId = selectedPlanId;
    this.data.snapshot.inputRevision += 1;
  }
}

export type Intent = 'prepare_from_drawing' | 'adapt_to_site';
export type Goal = Intent | 'export_selected_package' | 'read_site_evidence';
export interface Version { inputRevision: number; configVersion: string }
export const operations = [
  'prepare_drawing_model', 'derive_work_package', 'generate_change_candidates',
  'evaluate_work_package', 'compare_candidates', 'request_input',
  'export_work_package',
] as const;
export type Operation = typeof operations[number];
export type OutputKind = 'model' | 'candidates' | 'package' | 'evaluation' | 'comparison' | 'export';
export interface OutputRef extends Version {
  id: string;
  kind: OutputKind;
  subjectId: string;
}
export interface InputQuestion {
  id: string;
  text: string;
  kind: 'fact' | 'candidate_selection';
  subjectId: string;
}
export interface Gap {
  id: string;
  description: string;
  // Only dependent operations are gated. A missing rule source need not gate detailing.
  blocks: Operation[];
  question?: InputQuestion;
}
export interface WorkSnapshot extends Version {
  id: string;
  intent: Intent;
  drawingId: string;
  baselinePlanId: string;
  changeRequestId?: string;
  selectedPlanId?: string; // Only the explicit user API may set this.
  outputs: OutputRef[];
  gaps: Gap[];
}
export interface BoundAction {
  id: string;
  operation: Operation;
  description: string;
  subjectId: string;
  ruleId?: string;
  ruleVersion?: string;
}
export interface ExecutionContext extends Version {
  packageId: string;
  runId: string;
  actionId: string;
  signal: AbortSignal;
}
export interface DomainResult { summary: string; payload: unknown; modelResult?: unknown }
export interface RuleDescriptor {
  id: string; version: string; title: string; check: string; applicability: string;
  subjectTypes: string[]; requiredInputs: string[]; sourceRefs: unknown[];
  implementationStatus: string; executionFunction: string | null;
}
export interface DomainPort {
  evidenceImage?(packageId: string): Promise<{ data: string; mimeType: string; metadata: unknown }>;
  saveReading?(packageId: string, runId: string, reading: unknown): unknown;
  inspect?(packageId: string, query: {kind:'snapshot'|'drawing'|'sources'|'results'|'answers'; id?:string; query?:string}): unknown | Promise<unknown>;
  ruleCatalog?(packageId: string): RuleDescriptor[];
  // Return detached, validated domain state. Derive gaps and output references from saved data.
  read(packageId: string): WorkSnapshot;
  // Stage computation only; never publish outputs or mutate inputs here. Honor signal.
  execute(action: BoundAction, context: ExecutionContext): Promise<DomainResult>;
  // Synchronous transaction: recheck both versions, validate payload and publish outputs.
  // Return false on conflict. No await between the guard and the commit in this single server.
  commit(action: BoundAction, result: DomainResult, context: ExecutionContext): boolean;
}
export type RunStatus = 'running' | 'waiting_input' | 'completed' | 'blocked' | 'interrupted' | 'failed' | 'cancelled';
export interface DecisionTrace extends Version {
  stage: string;
  eligibleIds: string[];
  selectedId?: string;
  source: 'jev';
  model?: string;
  confidence?: number;
}
export interface RunRecord extends Version {
  id: string;
  packageId: string;
  goal: Goal;
  status: RunStatus;
  steps: number;
  startedAt: string;
  endedAt?: string;
  reason?: string;
  explanation?: string;
  latestAction?: string;
  latestResult?: string;
  latestDecision?: DecisionTrace;
  error?: string;
  question?: InputQuestion;
}
export interface RunStore {
  get(id: string): RunRecord | undefined;
  save(run: RunRecord): void;
  interruptRunning(): void;
}
export function sameVersion(a: Version, b: Version): boolean {
  return a.inputRevision === b.inputRevision && a.configVersion === b.configVersion;
}
export function currentOutputs(s: WorkSnapshot): OutputRef[] {
  return s.outputs.filter(o => sameVersion(s, o));
}

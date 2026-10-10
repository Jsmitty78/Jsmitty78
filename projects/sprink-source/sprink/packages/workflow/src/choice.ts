import type { Version, WorkSnapshot, Goal, RuleDescriptor } from './contracts.js';
import { sameVersion } from './contracts.js';

export const JEV_MODEL = 'jev-1.13.0';
export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const CLARIFY = 'needs_clarification';
export const SELECTION_DONE = 'selection_complete';
export interface ChoiceRequest {
  model: typeof JEV_MODEL;
  state: Version & {
    intent: WorkSnapshot['intent']; goal: Goal; planId: string; stage: string;
    gaps: { id: string; description: string }[];
    context?: unknown;
  };
  questions: { next_action: { type: 'choice'; instructions: string; criteria: Record<string, string> } };
}
// Version is local request correlation, NOT a field claimed to be echoed by the HTTP API.
export interface ChoiceEnvelope extends Version { response: unknown }
export interface ChoiceClient {
  choose(request: ChoiceRequest, signal: AbortSignal): Promise<ChoiceEnvelope>;
}
// JEV chooses a rule; calculation geometry and duplicated report catalogs stay in Pi's
// detailed tool context. This projection preserves every candidate and saved outcome.
function selectionContext(value: unknown): unknown {
  const root = value as Record<string, any> | undefined;
  if (!root || typeof root !== 'object') return value;
  const saved = root.savedInformation ?? {};
  const snapshot = saved.snapshot ?? {};
  const outcomes = new Map<string, unknown>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, any>;
    if (typeof row.ruleId === 'string' && row.status) {
      const outcome = {ruleId:row.ruleId,subjectIds:row.subjectIds,status:row.status,
        reason:row.reason,missingInputs:row.missingInputs,verificationState:row.verificationState};
      outcomes.set(JSON.stringify(outcome),outcome);
    }
    if (row.basis && typeof row.basis === 'object' && typeof row.basis.status === 'string')
      outcomes.set('edition_basis', row.basis);
    for (const [key, child] of Object.entries(row))
      if (!['coverage','catalog','sourceRefs','sources','fabrication','input','plan'].includes(key)) visit(child);
  };
  visit(root.ruleResults); visit(saved.results);
  return {understanding:root.understanding,
    drawing:snapshot.sourceDrawing,
    subjects:snapshot.baselinePlan?.entities?.map((e:any)=>({id:e.id,kind:e.kind,productId:e.productId})),
    facts:[...(snapshot.detailing ?? []),...(snapshot.siteFacts ?? [])].map((f:any)=>({
      id:f.id,field:f.field,value:f.value,unit:f.unit,subjectIds:f.subjectIds,
      confirmation:f.confirmation,provenance:f.provenance,source:f.source,unknownReason:f.unknownReason})),
    changeRequest:snapshot.changeRequest,selectedPlanId:snapshot.selectedPlan?.id,
    answers:snapshot.answers,priorRuleOutcomes:[...outcomes.values()]};
}
export function ruleChoiceRequest(s: WorkSnapshot, goal: Goal, rules: RuleDescriptor[], context: unknown): ChoiceRequest {
  if (rules.length > 253 || new Set(rules.map(r => r.id)).size !== rules.length || rules.some(r => [CLARIFY, SELECTION_DONE].includes(r.id))) throw new Error('invalid_rule_catalog');
  const describe = (r: RuleDescriptor) => {
    const sources=r.sourceRefs.map(value=>{if (typeof value === 'string') return value; const ref=value as Record<string,unknown>;return [ref.documentId ?? ref.document,ref.revision,ref.clauses].filter(Boolean).join(' ');});
    return `${r.title}; ${r.implementationStatus}; ${r.check}${r.applicability===r.check?'':`; Applies: ${r.applicability}`} Subjects: ${r.subjectTypes.join(',')}. Inputs: ${r.requiredInputs.join(',')}. Sources: ${[...new Set(sources)].join(';')}. Version ${r.version}.`;
  };
  return {model:JEV_MODEL, state:{inputRevision:s.inputRevision,configVersion:s.configVersion,intent:s.intent,goal,
    planId:s.selectedPlanId ?? s.baselinePlanId,gaps:s.gaps.map(g=>({id:g.id,description:g.description})),
    stage:'select_verification_rule', context:selectionContext(context)}, questions:{next_action:{type:'choice',
    instructions:'Select ONE sprinkler verification rule with a unique highest probability (never a tied maximum) to execute next using applicability, facts and prior outcomes. Never select business operations. Do not repeat a rule on unchanged subjects/inputs already checked. Keep unimplemented/source-pending checks visible.'+
      (goal==='prepare_from_drawing' ? ' Explicit synthetic_assumption facts are supported for provisional calculations: select an applicable executable rule even when its finding will be UNKNOWN because physical evidence is missing.' : '')+
      ' Choose needs_clarification only if missing evidence prevents identifying any applicable rule; an executable check may report missing inputs. Choose selection_complete when no further catalog rule is useful. Completion and all-pass are not coverage or construction approval.',
    criteria:Object.fromEntries([...rules.map(r => [r.id, describe(r)]),
      [CLARIFY,'More information is needed to choose a verification rule.'],
      [SELECTION_DONE,'No further catalog rule is useful for this context; no coverage/approval claim.']])}}};
}
const object = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const probability = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
export class ChoiceFailure extends Error {}
export function validateChoice(envelope: ChoiceEnvelope, request: ChoiceRequest): { id: string; confidence: number } {
  const fail = (reason: string): never => { throw new ChoiceFailure(reason); };
  if (!object(envelope) || !sameVersion(envelope, request.state)) return fail('choice_version_mismatch');
  const r = envelope.response;
  if (!object(r) || r.model !== request.model) return fail('choice_model_mismatch');
  if (!object(r.answers) || Object.keys(r.answers).length !== 1) return fail('invalid_answers');
  const a = r.answers.next_action;
  if (!object(a) || a.type !== 'choice' || typeof a.choice !== 'string' || !probability(a.confidence)) return fail('invalid_choice_shape');
  // Reject generated arguments and other unsupported answer fields.
  if (Object.keys(a).some(k => !['type', 'choice', 'confidence', 'probabilities'].includes(k))) return fail('unexpected_choice_fields');
  const ids = Object.keys(request.questions.next_action.criteria);
  if (!ids.includes(a.choice)) return fail('ineligible_choice');
  const p = a.probabilities;
  if (!object(p) || Object.keys(p).length !== ids.length || ids.some(id => !Object.hasOwn(p, id) || !probability(p[id]))) return fail('invalid_distribution');
  const values = ids.map(id => p[id] as number);
  // The service returns hundredth-rounded masses (observed 49 options summing to 0.99).
  // Accept only the mathematically possible rounding error; retain raw probabilities.
  const roundedHundredths = values.every(n => Math.abs(n * 100 - Math.round(n * 100)) < 1e-8);
  const tolerance = roundedHundredths ? ids.length * 0.005 + 1e-8 : 1e-6;
  const sum = values.reduce((total, n) => total + n, 0);
  if (sum <= 0 || Math.abs(sum - 1) > tolerance) return fail('distribution_sum');
  const maximum = Math.max(...values);
  if (p[a.choice] !== maximum) return fail('choice_not_maximum');
  if (values.filter(n => n === maximum).length !== 1) return fail('ambiguous_distribution');
  return { id: a.choice, confidence: a.confidence };
}

/** Official HTTP endpoint, one request, no retries or generative fallback. */
export class JevHttpClient implements ChoiceClient {
  constructor(private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {
    if (!apiKey.trim()) throw new Error('TYPESAFE_API_KEY is required');
  }
  async choose(request: ChoiceRequest, signal: AbortSignal): Promise<ChoiceEnvelope> {
    let response: Response;
    try {
      response = await this.fetcher(JEV_ENDPOINT, { method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(request) });
    } catch { throw new ChoiceFailure(signal.aborted ? 'choice_aborted' : 'choice_network_error'); }
    if (!response.ok) throw new ChoiceFailure(`choice_http_${response.status}`);
    let body: unknown;
    try { body = await response.json(); } catch { throw new ChoiceFailure('choice_invalid_json'); }
    return { inputRevision: request.state.inputRevision, configVersion: request.state.configVersion, response: body };
  }
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { SourceStore } from '../apps/server/src/sources/store.js';
import { getProjectRuleCatalog } from '../packages/core/src/project-evaluator.js';
import { FieldService } from '../apps/server/src/service.js';
import { WorkPackageStore } from '../apps/server/src/work-packages/store.js';
import { createIntegratedServices } from '../apps/server/src/integration/runtime.js';
import { integratedInput } from '../apps/server/test/fixtures/integrated-package.js';
import { JevHttpClient, validateChoice, workflowLlmFromEnv, CLARIFY, SELECTION_DONE } from '../packages/workflow/src/index.js';
import type { ExportManifest } from '../apps/server/src/exports/types.js';

// Opt-in paid integration verification. Engineering inputs and operator actions are
// synthetic. Judge results in memory, then delete the entire isolated test directory.
const flags = new Set(process.argv.slice(2));
for (const flag of flags) assert(['--site-only', '--drawing-only', '--check-cleanup'].includes(flag) || /^--model=gpt-6-(astra|sol|luna)$/.test(flag) || /^--effort=(low|medium)$/.test(flag) || /^--budget-usd=\d+(?:\.\d+)?$/.test(flag), 'Only documented flags are accepted; output paths are not supported.');
assert(!(flags.has('--site-only') && flags.has('--drawing-only')), 'Choose at most one scenario flag.');
const modelFlags = [...flags].filter(flag => flag.startsWith('--model='));
const effortFlags = [...flags].filter(flag => flag.startsWith('--effort='));
assert(modelFlags.length <= 1 && effortFlags.length <= 1, 'Specify one model and one effort.');
const modelId = modelFlags[0]?.slice('--model='.length) ?? 'gpt-6-astra';
const reasoningEffort = (effortFlags[0]?.slice('--effort='.length) ?? 'low') as 'low' | 'medium';
const budgetUsd = Number([...flags].find(flag => flag.startsWith('--budget-usd='))?.slice('--budget-usd='.length) ?? '8');
assert(budgetUsd > 0 && budgetUsd <= 25, 'Budget must be above zero and no greater than $25.');
const rates: Record<string, {input:number;cacheRead:number;cacheWrite:number;output:number}> = {
  'gpt-6-astra':{input:10,cacheRead:1,cacheWrite:12.5,output:50},
  'gpt-6-sol':{input:2,cacheRead:.2,cacheWrite:2.5,output:10},
  'gpt-6-luna':{input:.1,cacheRead:.01,cacheWrite:.125,output:.5},
};
function openaiRequestUsd(usage: Record<string, number>) {
  const rate = rates[modelId];
  const requestInput = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  const longContext = requestInput > 272000;
  const inputCost = (usage.input ?? 0) * rate.input + (usage.cacheRead ?? 0) * rate.cacheRead + (usage.cacheWrite ?? 0) * rate.cacheWrite;
  return (inputCost * (longContext ? 2 : 1) + (usage.output ?? 0) * rate.output * (longContext ? 1.5 : 1)) / 1e6;
}
function jevEstimatedUsd(usage: Record<string, number>) {
  return (usage.input_tokens ?? usage.input ?? usage.prompt_tokens ?? 0) * .042 / 1e6;
}
const summaries: Record<string, unknown>[] = [];
function numericUsage(value: unknown, totals: Record<string, number>, prefix = '') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'number' && Number.isFinite(child)) totals[path] = (totals[path] ?? 0) + child;
    else if (child && typeof child === 'object' && !Array.isArray(child)) numericUsage(child, totals, path);
  }
}
function newMetrics() {
  return { startedAt: Date.now(), wallMs: 0, firstAssistantUpdateMs: null as number | null,
    assistantMessages: 0, modelErrors: 0, usageUnavailable:0, maxRequestInputTokens:0, exceeds272kInput:false, openaiEstimatedUsd:0, estimatedUsd:0, assistantUsage: {} as Record<string, number>,
    failureDiagnostics: [] as Record<string,unknown>[], lastFinishStatus: null as string|null,
    toolCalls: 0, toolFailures: 0, toolNoProgress: 0, toolsByName: {} as Record<string, number>,
    jevCalls: 0, jevFailures: 0, jevTotalMs: 0, jevMaxMs: 0, jevUsageSamples: 0, jevUsageUnavailable:0, jevUsage: {} as Record<string, number> };
}
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

const scratchDirectories = new Set<string>();
async function temporaryRun<T>(work: (directory: string, signal: AbortSignal, onCancel: (cancel: () => void) => void) => Promise<T>): Promise<T> {
  const directory = mkdtempSync(join(tmpdir(), 'innovation-live-check-'));
  scratchDirectories.add(directory);
  const controller = new AbortController();
  let cancel = () => {};
  const interrupt = () => { controller.abort(); cancel(); };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try {
    return await work(directory, controller.signal, fn => { cancel = fn; if (controller.signal.aborted) fn(); });
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
    rmSync(directory, { recursive: true, force: true });
    assert(!existsSync(directory), 'Temporary verification data cleanup failed.');
    scratchDirectories.delete(directory);
  }
}

async function checkCleanup() {
  let passed = 0;
  for (const mode of ['success', 'failure', 'SIGINT', 'SIGTERM'] as const) {
    let location = '', cancelled = false;
    try {
      await temporaryRun(async (directory, signal, onCancel) => {
        location = directory;
        mkdirSync(join(directory, 'exports'));
        for (const filename of ['test.sqlite', 'test.sqlite-wal', 'events.jsonl', 'exports/draft.pdf', 'exports/bom.csv']) writeFileSync(join(directory, filename), 'synthetic cleanup probe');
        onCancel(() => { cancelled = true; });
        if (mode === 'failure') throw new Error('expected_cleanup_probe');
        if (mode === 'SIGINT' || mode === 'SIGTERM') {
          process.emit(mode);
          assert(signal.aborted && cancelled, 'Signal did not cancel active verification.');
          throw new Error('expected_cleanup_probe');
        }
      });
    } catch (error) {
      assert.notEqual(mode, 'success');
      assert.equal((error as Error).message, 'expected_cleanup_probe');
    }
    assert(location && !existsSync(location), `Cleanup failed for ${mode}`);
    passed++;
  }
  return { cleanupChecks: passed, paidCalls: 0, retainedOutputs: 0 };
}

function csvRows(bytes: Buffer): string[][] {
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && c === ',') { row.push(cell); cell = ''; }
    else if (!quoted && c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  assert(!quoted && row.length === 0 && cell === '', 'Malformed or unterminated CSV.');
  assert(rows.length >= 2 && rows.every(row => row.length === rows[0].length), 'CSV rows do not match header width.');
  assert(rows[0].includes('package_id') && rows[0].includes('approval_status'), 'CSV lacks required provenance columns.');
  const approvalIndex = rows[0].indexOf('approval_status');
  assert(rows.slice(1).every(row => row[approvalIndex] === 'not_established_by_export'), 'CSV incorrectly establishes approval.');
  return rows;
}

async function live(directory: string, signal: AbortSignal, onCancel: (cancel: () => void) => void) {
  const local = parseEnv(readFileSync(new URL('../.env.local', import.meta.url), 'utf8'));
  const llm = {...workflowLlmFromEnv(process.env, local, modelId), reasoningEffort};
  let metrics: ReturnType<typeof newMetrics> | undefined;
  let currentSummary: Record<string, unknown> | undefined;
  const key = local.TYPESAFE_API_KEY ?? process.env.TYPESAFE_API_KEY;
  assert(key, 'Project JEV credential missing');
  const field = new FieldService(directory);
  new SourceStore(field.store.db).import({id:'benchmark-draft-scope',title:'Synthetic review-draft scope',publisher:'Benchmark fixture',type:'project_document',edition:'1',scope:{projectId:'live-rule-loop'},demonstration:true,authorization:{basis:'Authored synthetic test reference',storeAndIndex:true,useWithAi:true,display:'full'},content:'## 1.1 Review draft\nThis worksheet is a review draft. Work-area access and physical endpoint closure are not established by this document.',filename:'benchmark-draft-scope.md'});
  let sourceTextRead=false, resultsReturnedToJev=false, budgetExceeded=false;
  const supportedRules = new Set<string>();
  const budgetCheck = () => {
    if(metrics) metrics.estimatedUsd=metrics.openaiEstimatedUsd+jevEstimatedUsd(metrics.jevUsage);
    const spent=summaries.reduce((sum,s)=>sum+((s.metrics as ReturnType<typeof newMetrics>|undefined)?.estimatedUsd ?? 0),0);
    if(spent >= budgetUsd) {budgetExceeded=true;if(active) integrated.packages.cancel(active.id,active.runId);}
  };
  const agents = new Set<string>();
  const selectedRules = new Set<string>();
  const executedRules = new Set<string>();
  const pendingRules = new Map<string,string>();
  const pendingToolDiagnostics = new Map<string,Record<string,unknown>>();
  const addDiagnostic = (diagnostic:Record<string,unknown>) => {
    if(metrics) {metrics.failureDiagnostics.push(diagnostic);if(metrics.failureDiagnostics.length>8) metrics.failureDiagnostics.shift();}
  };
  const safeErrorCode = (value:unknown):string => {
    if(typeof value!=='string') return 'tool_error_without_code';
    const fixed:Record<string,string>={
      'Inspect all relevant saved information before asking.':'required_inspections_missing',
      'Generate and compare current candidates before requesting user adoption.':'candidate_comparison_missing',
      'Requested outputs are not yet available.':'required_outputs_missing',
      'Call select_verification_rule and use its selected ruleId first.':'rule_not_selected',
      'Invalid verification target. Use the work-package ID for all calculated plans or a current calculated plan ID; change requests and candidate sets are not rule targets.':'invalid_rule_target',
      'A user-adopted plan is saved. Derive the current selected plan using its preserved geometry. The user must clear selection before generating a new candidate set.':'adopted_plan_regeneration_blocked',
    };
    if(fixed[value]) return fixed[value];
    if(['domain_or_adapter_error','unknown_rule_target','input_or_config_changed','step_limit','cancelled','run_stopped','choice_service_failure','runner_failed','ambiguous_distribution','distribution_sum'].includes(value) || /^choice_(?:http_\d{3}|network_error|aborted|invalid_json|version_mismatch|model_mismatch)$/.test(value)) return value;
    return 'unclassified_error_text_omitted';
  };
  const awaitingModelReview = new Set<string>();
  let modelReviews = 0;
  let choiceCalls = 0, toolCalls = 0, compared = false, active: { id: string; runId: string } | undefined;
  const client = new JevHttpClient(key);
  const integrated = (() => {
    try { return createIntegratedServices(new WorkPackageStore(field.store.db), directory, {
    llm,
    choice: { async choose(request, requestSignal) {
      assert(!budgetExceeded, 'Metered usage budget reached.');
      assert.deepEqual(Object.keys(request.questions.next_action.criteria).sort(),[...getProjectRuleCatalog().map(rule=>rule.id),CLARIFY,SELECTION_DONE].sort(),'JEV catalog changed or filtered.');
      if(executedRules.size) {
        const prior=(request.state.context as {priorRuleOutcomes?:unknown[]}|undefined)?.priorRuleOutcomes ?? [];
        const serialized=JSON.stringify(prior);
        if([...executedRules].some(id=>serialized.includes(id)) || prior.some(outcome=>!!outcome && typeof outcome==='object' && 'status' in outcome)) resultsReturnedToJev=true;
      }
      choiceCalls++;
      metrics!.jevCalls++;
      const choiceStarted = Date.now();
      let usageAccounted = false;
      try {
      const response = await client.choose(request, requestSignal);
      const body = response.response as Record<string, unknown>;
      const reported = body.usage ?? body.token_usage ?? (body.metadata as Record<string,unknown>|undefined)?.usage;
      if (reported && typeof reported === 'object') { metrics!.jevUsageSamples++; numericUsage(reported, metrics!.jevUsage); } else metrics!.jevUsageUnavailable++;
      usageAccounted = true;
      const choice = validateChoice(response, request);
      if (![CLARIFY, SELECTION_DONE].includes(choice.id)) selectedRules.add(choice.id);
      return response;
      } catch (error) { metrics!.jevFailures++; if (!usageAccounted) metrics!.jevUsageUnavailable++; throw error; }
      finally { const elapsed = Date.now() - choiceStarted; metrics!.jevTotalMs += elapsed; metrics!.jevMaxMs = Math.max(metrics!.jevMaxMs, elapsed); budgetCheck(); }
    } },
    onEvent(runId, event) {
      if (metrics && event.type === 'message_update' && metrics.firstAssistantUpdateMs === null && /_delta$/.test(event.assistantMessageEvent.type)) metrics.firstAssistantUpdateMs = Date.now() - metrics.startedAt;
      if (metrics && event.type === 'message_end' && event.message.role === 'assistant') {
        metrics.assistantMessages++;
        numericUsage(event.message.usage, metrics.assistantUsage);
        const usage=event.message.usage;
        metrics.openaiEstimatedUsd += openaiRequestUsd({input:usage.input,cacheRead:usage.cacheRead,cacheWrite:usage.cacheWrite,output:usage.output});
        const input=usage.input+usage.cacheRead+usage.cacheWrite;
        metrics.maxRequestInputTokens=Math.max(metrics.maxRequestInputTokens,input);
        metrics.exceeds272kInput ||= input>272000;
        if ((event.message.stopReason==='error' || event.message.stopReason==='aborted') && usage.totalTokens===0) metrics.usageUnavailable++;
        budgetCheck();
        if (event.message.stopReason === 'error' || event.message.stopReason === 'aborted') metrics.modelErrors++;
      }
      if (metrics && event.type === 'tool_execution_end') {
        const detail = event.result.details as {error?:unknown;noProgress?:boolean;status?:string}|undefined;
        if (event.isError || detail?.error || detail?.status === 'missing_inputs') {
          metrics.toolFailures++;
          const extended=event.result.details as {missingInspections?:unknown[];missing?:unknown[]}|undefined;
          const missingInspections=extended?.missingInspections?.filter(value=>['drawing','sources','results','answers'].includes(String(value)));
          const missingOutputs=extended?.missing?.filter(value=>['package','evaluation','export','user_candidate_adoption'].includes(String(value)));
          addDiagnostic({tool:event.toolName,...pendingToolDiagnostics.get(event.toolCallId),errorCode:detail?.status==='missing_inputs'?'missing_inputs':safeErrorCode(detail?.error),missingInspections,missingOutputs,selectedRuleIds:[...selectedRules].slice(-8)});
        }
        pendingToolDiagnostics.delete(event.toolCallId);
        if (detail?.noProgress) metrics.toolNoProgress++;
      }
      if (event.type === 'message_end' && event.message.role === 'assistant' && awaitingModelReview.delete(runId)) modelReviews++;
      if (event.type === 'agent_start') agents.add(runId);
      if (event.type === 'agent_end') agents.delete(runId);
      if (event.type === 'tool_execution_start') {
        toolCalls++;
        metrics!.toolCalls++;
        metrics!.toolsByName[event.toolName] = (metrics!.toolsByName[event.toolName] ?? 0) + 1;
        if(event.toolName==='finish_work' && ['completed','blocked'].includes(event.args.status)) metrics!.lastFinishStatus=event.args.status;
        if(active) {
          const snapshot=integrated.packages.get(active.id), state=integrated.details(active.id).state;
          const availablePlanIds=state?.details.map(detail=>detail.plan.id) ?? [];
          const subject=event.args.subjectId;
          const hasSubject=typeof subject==='string';
          const subjectMatches={package:hasSubject && subject===snapshot.id,baseline:hasSubject && subject===snapshot.baselinePlan?.id,selected:hasSubject && subject===snapshot.selectedPlan?.id,calculatedPlan:hasSubject && availablePlanIds.includes(subject),candidateOutput:hasSubject && subject===snapshot.outputs.candidates?.id,changeRequest:hasSubject && subject===snapshot.changeRequest?.id};
          const recognized=Object.values(subjectMatches).some(Boolean);
          pendingToolDiagnostics.set(event.toolCallId,{requestedRuleId:getProjectRuleCatalog().some(rule=>rule.id===event.args.ruleId)?event.args.ruleId:undefined,requestedSubjectId:typeof subject==='string'?(recognized?subject:'unrecognized_subject'):undefined,subjectMatches,availablePlanIds,packageRefSubjectIds:state?.refs.filter(ref=>ref.kind==='package').map(ref=>ref.subjectId),questionKind:['fact','candidate_selection'].includes(event.args.kind)?event.args.kind:undefined});
        }
        if (event.toolName === 'evaluate_work_package') pendingRules.set(event.toolCallId, event.args.ruleId);
      }
      if (event.type === 'tool_execution_end' && !event.isError) {
        const result = event.result.details as { passages?:{documentId:string;section:{text:string}}[]; result?: { plans?: { ruleExecutions?: {ruleId:string;result?:{implementationStatus?:string;executionStatus?:string}}[] }[] }; noProgress?: boolean; error?: unknown } | undefined;
        if(event.toolName==='inspect_saved_information' && result?.passages?.some(p=>p.documentId==='benchmark-draft-scope' && p.section.text.includes('physical endpoint closure'))) sourceTextRead=true;
        const calledRule = pendingRules.get(event.toolCallId);
        pendingRules.delete(event.toolCallId);
        if (event.toolName === 'evaluate_work_package' && calledRule && !result?.noProgress && !result?.error) {
          const actual = result?.result?.plans?.flatMap(plan => plan.ruleExecutions ?? []) ?? [];
          if (actual.some(execution => execution.ruleId === calledRule)) {
            assert(selectedRules.has(calledRule), 'A rule executed without live JEV selection.');
            executedRules.add(calledRule);
            if(actual.some(execution=>execution.ruleId===calledRule && execution.result?.implementationStatus==='supported' && execution.result?.executionStatus==='executed')) supportedRules.add(calledRule);
            awaitingModelReview.add(runId);
          }
        }
        if (event.toolName === 'compare_candidates' && !result?.error) compared = true;
      }
    },
  }); } catch (error) { field.store.close(); throw error; }
  })();
  onCancel(() => { if (active) integrated.packages.cancel(active.id, active.runId); });
  async function run(id: string, goal?: string) {
    signal.throwIfAborted();
    assert(!budgetExceeded, 'Metered usage budget reached.');
    const phaseStarted=Date.now();
    const before = integrated.packages.get(id);
    const started = integrated.packages.start(id, { expectedRevision: before.inputRevision, goal: goal ?? before.intent });
    active = { id, runId: started.run.id };
    const deadline = Date.now() + 12 * 60_000;
    while (Date.now() < deadline) {
      await pause(100);
      signal.throwIfAborted();
      const current = integrated.packages.get(id);
      if (current.run?.status !== 'running') {
        const latest=integrated.details(id).state?.latestRun;
        if(currentSummary) currentSummary.lastRun={status:current.run?.status,workflowStatus:latest?.status,errorCode:latest?.error?safeErrorCode(latest.error):undefined,reasonCode:latest?.reason?safeErrorCode(latest.reason):undefined,latestAction:latest?.latestAction,finishStatus:metrics?.lastFinishStatus};
        active = undefined;
        console.log(JSON.stringify({phase:goal ?? before.intent,model:modelId,reasoningEffort,status:current.run?.status,wallMs:Date.now()-phaseStarted,estimatedUsd:metrics?.estimatedUsd ?? null}));
        assert(current.run?.status !== 'failed' && current.run?.status !== 'cancelled', `Live run stopped: ${integrated.details(id).state?.latestRun?.error ?? current.run?.status}`);
        return current;
      }
    }
    integrated.packages.cancel(id, started.run.id);
    throw new Error('Live run deadline');
  }
  try {
    for (const scenario of (flags.has('--site-only') ? [3] : flags.has('--drawing-only') ? [2] : [2, 3]) as (2 | 3)[]) {
      metrics = newMetrics();
      currentSummary = { scenario: scenario === 2 ? 'drawing' : 'site', judgment: 'running', metrics };
      summaries.push(currentSummary);
      sourceTextRead=false;resultsReturnedToJev=false;supportedRules.clear();
      selectedRules.clear(); executedRules.clear(); awaitingModelReview.clear(); modelReviews = 0; compared = false;
      const startChoiceCalls = choiceCalls, startToolCalls = toolCalls;
      let answers = 0, adoption = false;
      const created = integrated.packages.create({ projectId: 'live-rule-loop', title: 'Synthetic live-service acceptance', intent: scenario === 2 ? 'prepare_from_drawing' : 'adapt_to_site' });
      const asset = await integrated.packages.upload(created.id, Buffer.from('%PDF-1.4\nSynthetic service test; structured inputs are authoritative for this test.'), 'application/pdf', 'synthetic.pdf');
      const input = integratedInput(asset.id, scenario, scenario === 2);
      if (scenario === 2) input.detailing = input.detailing.filter(f => f.field !== 'workAreaAccess');
      let s = integrated.packages.edit(created.id, { expectedRevision: 1, patch: input });
      s = await run(s.id);
      let adoptedGraph:unknown;
      for (let answerIndex = 0; answerIndex < (scenario === 2 ? 1 : 3) && s.run?.status === 'waiting_input'; answerIndex++) {
        const question = integrated.details(s.id).state?.latestRun?.question;
        if (question?.kind === 'candidate_selection') break;
        const q = s.outputs.requests.find(q => q.inputRevision === s.inputRevision && !s.answers.some(a => a.requestId === q.id));
        assert(q, 'Waiting run lacks a saved user question.');
        const revision = s.inputRevision;
        s = integrated.packages.answer(s.id, { expectedRevision: revision, requestId: q.id, value: null, unavailableReason: 'Synthetic test operator: no additional real field evidence is available. Preserve unknowns and produce bounded review drafts; do not approve installation.' });
        assert(s.inputRevision > revision && s.answers.some(a => a.requestId === q.id), 'Answer was not persisted at a new revision.');
        answers++;
        s = await run(s.id);
      }
      if (scenario === 2) assert(answers > 0, 'Drawing scenario did not demonstrate question, saved answer and resumed run.');
      if (scenario === 3) {
        assert(compared && s.outputs.candidates?.candidates.length, 'Site scenario lacks a completed candidate comparison.');
        assert.equal(integrated.details(s.id).state?.latestRun?.question?.kind, 'candidate_selection', 'Site scenario did not request human adoption.');
        const candidateTotals=integrated.details(s.id).state!.details.slice(1).map(d=>d.fabrication.cuts.reduce((sum,cut)=>sum+(cut.cutLength.value ?? NaN),0)).sort((a,b)=>a-b);
        assert(candidateTotals.length===2 && Math.abs(candidateTotals[0]-12.4333)<1e-8 && Math.abs(candidateTotals[1]-12.9333)<1e-8,'Candidate cut totals differ from fixed fixture expectations.');
        s = integrated.packages.select(s.id, { expectedRevision: s.inputRevision, planId: s.outputs.candidates.candidates[0].plan.id });
        assert(s.selectedPlan, 'Simulated human selection was not saved.'); adoption = true;adoptedGraph=structuredClone(s.selectedPlan);
        s = await run(s.id);
      }
      s = await run(s.id, 'export_selected_package');
      assert.equal(s.run?.status,'completed','Export did not complete the requested goal.');
      if(adoptedGraph) assert.deepEqual(s.selectedPlan,adoptedGraph,'Adopted geometry changed without human selection.');
      if(scenario===2) assert.deepEqual(integrated.details(s.id).state!.details[0].fabrication.cuts.map(c=>c.cutLength.value),[0.5762625,0.4238625],'Drawing cut lengths differ from fixed fixture expectations.');
      assert(sourceTextRead,'Registered source passage was not inspected.');
      assert(supportedRules.size>0,'No supported rule actually executed; pending placeholders are insufficient.');
      assert(resultsReturnedToJev,'Script results were not returned to a later live JEV request.');
      assert(choiceCalls > startChoiceCalls && selectedRules.size && executedRules.size, 'Scenario lacks actual JEV selection followed by script execution.');
      assert(modelReviews > 0, 'Scenario lacks a model response following a script result.');
      const files = new Map<string, Buffer>();
      for (const artifact of s.outputs.artifacts.filter(a => a.inputRevision === s.inputRevision && a.configVersion === s.configVersion)) {
        const file = integrated.packages.artifact(s.id, artifact.id);
        files.set(artifact.kind, file.bytes);
      }
      for (const kind of ['pdf', 'bom_csv', 'cut_csv', 'manifest']) assert(files.has(kind), `Missing current ${kind} artifact.`);
      const pdf = files.get('pdf')!;
      assert(pdf.subarray(0, 5).toString() === '%PDF-' && pdf.subarray(-1024).toString().includes('%%EOF'), 'Invalid PDF signature or trailer.');
      const bom = csvRows(files.get('bom_csv')!), cuts = csvRows(files.get('cut_csv')!);
      const manifest = JSON.parse(files.get('manifest')!.toString('utf8')) as ExportManifest;
      assert(manifest.schemaVersion === 1 && manifest.draft === true && manifest.binding.packageId === s.id && manifest.binding.inputRevision === s.inputRevision && manifest.binding.configVersion === s.configVersion && manifest.binding.selectionId === (s.selectedPlan?.id ?? s.baselinePlan!.id), 'Manifest does not bind a current draft.');
      const named = { 'work-package.pdf': pdf, 'bom.csv': files.get('bom_csv')!, 'cut-list.csv': files.get('cut_csv')! };
      assert(manifest.files.length === 3 && new Set(manifest.files.map(f => f.name)).size === 3, 'Invalid manifest file set.');
      for (const entry of manifest.files) {
        const bytes = named[entry.name];
        assert(bytes && entry.bytes === bytes.length && entry.sha256 === createHash('sha256').update(bytes).digest('hex'), 'Artifact bytes do not match manifest.');
      }
      metrics.wallMs = Date.now() - metrics.startedAt;
      Object.assign(currentSummary, { judgment: 'passed', choiceCalls: choiceCalls - startChoiceCalls, toolCalls: toolCalls - startToolCalls, executedRuleKinds: executedRules.size, modelResponsesAfterScripts: modelReviews, savedAnswers: answers, humanAdoption: adoption, artifacts: files.size, bomRows: bom.length - 1, cutRows: cuts.length - 1, unresolvedItems: manifest.unresolvedCount });
    }
    return { model: modelId, reasoningEffort, budgetUsd, costBasis:'Official standard API prices; reasoning included in output; missing usage is unknown, not zero.', syntheticInputs: true, constructionApproval: false, scenarios: summaries, retainedOutputs: 0 };
  } catch (error) {
    if (metrics) metrics.wallMs = Date.now() - metrics.startedAt;
    if (currentSummary) Object.assign(currentSummary, {judgment:'failed',reason:error instanceof Error ? error.message : 'verification_error'});
    throw error;
  } finally {
    if (active) integrated.packages.cancel(active.id, active.runId);
    integrated.packages.close();
    // Let Pi finish cancellation before closing its SQLite connection or deleting data.
    const deadline = Date.now() + 60_000;
    while (agents.size && Date.now() < deadline) await pause(25);
    field.store.close();
    assert(agents.size === 0, 'Pi did not finish cancellation within the cleanup deadline.');
  }
}

try {
  const result = flags.has('--check-cleanup') ? await checkCleanup() : await temporaryRun(live);
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({ model: modelId, reasoningEffort, judgment: 'failed', scenarios: summaries, reason: error instanceof Error ? error.message : 'verification_error', retainedOutputs: scratchDirectories.size ? 'cleanup_failed' : 0 }));
  process.exitCode = 1;
}

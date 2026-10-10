import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai/utils/event-stream';
import type { ChoiceClient, WorkSnapshot } from '../src/index.js';
/** Explicit synthetic model for domain integration tests; never imported by production. */
export const integrationStream: StreamFn = (model, context) => {
  const stream = new AssistantMessageEventStream();
  const initial = context.messages.find(m => m.role === 'user')!;
  const prompt = typeof initial.content === 'string' ? initial.content : initial.content.filter(c=>c.type==='text').map(c=>c.text).join('');
  const goal = prompt.match(/Goal: ([^.]+)/)![1];
  const start = JSON.parse(prompt.slice(prompt.indexOf('Current saved snapshot: ') + 'Current saved snapshot: '.length)) as WorkSnapshot;
  const results = context.messages.filter(m => m.role === 'toolResult');
  const parsed = results.map(m => ({ name: m.toolName, data: JSON.parse(m.content.filter(c => c.type === 'text').map(c => c.text).join('')) }));
  const latest = parsed.at(-1);
  let name = 'inspect_saved_information', args: Record<string, unknown> = { kind: 'snapshot' };
  const snapshot = parsed.filter(r => r.name === name && r.data.workflow).at(-1)?.data.workflow as WorkSnapshot | undefined;
  const s = snapshot ?? start;
  const ran = (op: string) => parsed.some(r => r.name === op);
  const base = { subjectId: s.id };
  const inspected = context.messages.filter(m=>m.role==='assistant').flatMap(m=>m.content.filter(c=>c.type==='toolCall' && c.name==='inspect_saved_information').map(c=>(c as any).arguments.kind));
  if (!parsed.length) { /* start with persisted facts */ }
  else if (['drawing','sources','results','answers'].some(kind=>!inspected.includes(kind))) { args={kind:['drawing','sources','results','answers'].find(kind=>!inspected.includes(kind)),query:'cut'}; }
  else if (goal === 'export_selected_package') {
    name = ran('export_work_package') ? 'finish_work' : 'export_work_package';
    args = name === 'finish_work' ? { status: 'completed', explanation: 'Synthetic test export finished.' } : base;
  } else if (!ran('prepare_drawing_model')) { name = 'prepare_drawing_model'; args = base; }
  else if (s.intent === 'adapt_to_site' && !s.selectedPlanId && !ran('generate_change_candidates')) { name = 'generate_change_candidates'; args = base; }
  else if (latest?.name === 'generate_change_candidates') { /* refresh generation gaps */ }
  else if (s.gaps.some(g => g.blocks.includes('generate_change_candidates') || g.blocks.includes('prepare_drawing_model'))) {
    const gap = s.gaps.find(g => g.question);
    name = gap ? 'request_input' : 'finish_work'; args = gap ? {...gap.question!} : {status:'blocked',explanation:'Saved input missing'};
  } else if (!ran('derive_work_package')) { name = 'derive_work_package'; args = base; }
  else if (!ran('select_verification_rule')) { name = 'select_verification_rule'; args = { context: 'Synthetic integration selection over full catalog.' }; }
  else if (latest?.name === 'select_verification_rule' && latest.data.status === 'selected') { name = 'evaluate_work_package'; args = {...base, ruleId: latest.data.rule.id}; }
  else if (s.intent === 'adapt_to_site' && !ran('compare_candidates')) { name = 'compare_candidates'; args = base; }
  else {
    const question = s.gaps.find(g => g.question)?.question;
    if (question) { name = 'request_input'; args = {...question}; }
    else if (s.intent === 'adapt_to_site' && !s.selectedPlanId) { name = 'request_input'; args = {id:'candidate-selection',text:'Select a candidate in the saved alternatives.',kind:'candidate_selection',subjectId:s.changeRequestId!}; }
    else { name = 'finish_work'; args = {status:'completed',explanation:'Synthetic model completed saved computations; not completeness or installation approval.'}; }
  }
  const message: AssistantMessage = {role:'assistant',content:[{type:'toolCall',id:crypto.randomUUID(),name,arguments:JSON.parse(JSON.stringify(args))}],api:model.api,provider:model.provider,model:model.id,stopReason:'toolUse',timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
  stream.push({type:'start',partial:message});
  stream.push({type:'toolcall_start',contentIndex:0,partial:message});
  stream.push({type:'toolcall_end',contentIndex:0,toolCall:message.content[0] as any,partial:message});
  stream.push({type:'done',reason:'toolUse',message}); stream.end(message); return stream;
};
export const integrationChoice: ChoiceClient = {async choose(request) {
  const ids = Object.keys(request.questions.next_action.criteria);
  const choice = ids.find(id => id.startsWith('TFP171')) ?? ids[0];
  return {inputRevision:request.state.inputRevision,configVersion:request.state.configVersion,response:{model:request.model,answers:{next_action:{type:'choice',choice,confidence:1,probabilities:Object.fromEntries(ids.map(id => [id,id===choice?1:0]))}}}};
}};

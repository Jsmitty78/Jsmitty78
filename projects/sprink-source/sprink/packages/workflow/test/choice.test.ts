import { expect, it } from 'vitest';
import { ruleChoiceRequest, validateChoice, JevHttpClient, CLARIFY, SELECTION_DONE, type ChoiceRequest } from '../src/choice.js';
import { FixtureDomain } from './fixtures/domain.js';
export const rules=[{id:'spacing',version:'1',title:'Head spacing',check:'Measure spacing',applicability:'Applicable head family',subjectTypes:['head'],requiredInputs:['positions'],sourceRefs:[{documentId:'source:1',revision:'1',clauses:['clause 1']}],implementationStatus:'implemented',executionFunction:'spacing'}];
export function choiceEnvelope(request:ChoiceRequest,id:string) {
  return {...request.state,response:{model:request.model,answers:{next_action:{type:'choice',choice:id,confidence:1,probabilities:Object.fromEntries(Object.keys(request.questions.next_action.criteria).map(key=>[key,key===id?1:0]))}}}};
}
function request(){const s=new FixtureDomain().read('fixture-package');return ruleChoiceRequest(s,s.intent,rules,{results:[]});}
it('sends the unfiltered rule catalog with distinct information and completion options',()=>{
  const r=request();expect(Object.keys(r.questions.next_action.criteria)).toEqual(['spacing',CLARIFY,SELECTION_DONE]);
  expect(r.questions.next_action.criteria.spacing).toContain('source:1');
  expect(r.questions.next_action.instructions).toContain('synthetic_assumption facts are supported for provisional calculations');
});
it.each(['spacing',CLARIFY,SELECTION_DONE])('accepts semantic outcome %s without fallback',id=>{const r=request();expect(validateChoice(choiceEnvelope(r,id),r).id).toBe(id);});
it.each(['foreign','stale','model','shape','distribution','tie'])('rejects %s response',kind=>{
  const r=request(), e=choiceEnvelope(r,'spacing');
  if(kind==='foreign') e.response.answers.next_action.choice='other';
  if(kind==='stale') e.inputRevision--;
  if(kind==='model') (e.response as any).model='other';
  if(kind==='shape') (e.response.answers.next_action as any).arguments={};
  if(kind==='distribution') e.response.answers.next_action.probabilities.spacing=0.2;
  if(kind==='tie') e.response.answers.next_action.probabilities={spacing:0.5,[CLARIFY]:0.5,[SELECTION_DONE]:0};
  expect(()=>validateChoice(e,r)).toThrow();
});
it('does not retry transport errors or expose response bodies',async()=>{
  let calls=0;const client=new JevHttpClient('test',async()=>{calls++;return new Response('private body',{status:503});});
  await expect(client.choose(request(),new AbortController().signal)).rejects.toThrow('choice_http_503');expect(calls).toBe(1);
});
function request49() {
  const snapshot=new FixtureDomain().read('fixture-package');
  return ruleChoiceRequest(snapshot,snapshot.intent,Array.from({length:47},(_,i)=>({...rules[0],id:`rule-${i}`})),{});
}
it('accepts 49 hundredth-rounded masses totalling 0.99 without mutating or renormalizing them',()=>{
  const r=request49(), envelope=choiceEnvelope(r,'rule-0');
  envelope.response.answers.next_action.probabilities=Object.fromEntries(Object.keys(r.questions.next_action.criteria).map((id,i)=>[id,i===0?0.51:0.01]));
  const before=structuredClone(envelope);
  expect(Object.keys(envelope.response.answers.next_action.probabilities)).toHaveLength(49);
  expect(Object.values(envelope.response.answers.next_action.probabilities).reduce((a,b)=>a+b,0)).toBeCloseTo(0.99);
  expect(validateChoice(envelope,r).id).toBe('rule-0');expect(envelope).toEqual(before);
});
it.each([0,0.5,1.3])('rejects impossible rounded mass sum %s for 49 choices',sum=>{
  const r=request49(), envelope=choiceEnvelope(r,'rule-0');
  envelope.response.answers.next_action.probabilities=Object.fromEntries(Object.keys(r.questions.next_action.criteria).map((id,i)=>[id,i===0?Math.min(sum,0.9):i===1?Math.max(0,sum-0.9):0]));
  expect(()=>validateChoice(envelope,r)).toThrow('distribution_sum');
});
it('does not apply hundredth tolerance to finer-grained probabilities',()=>{
  const r=request49(), envelope=choiceEnvelope(r,'rule-0');
  envelope.response.answers.next_action.probabilities=Object.fromEntries(Object.keys(r.questions.next_action.criteria).map((id,i)=>[id,i===0?0.511:0.01]));
  expect(()=>validateChoice(envelope,r)).toThrow('distribution_sum');
});
it('keeps unique argmax enforcement when accepting rounded masses',()=>{
  const r=request49(), envelope=choiceEnvelope(r,'rule-1');
  envelope.response.answers.next_action.probabilities=Object.fromEntries(Object.keys(r.questions.next_action.criteria).map((id,i)=>[id,i===0?0.51:0.01]));
  expect(()=>validateChoice(envelope,r)).toThrow('choice_not_maximum');
  envelope.response.answers.next_action.choice='rule-0';
  envelope.response.answers.next_action.probabilities=Object.fromEntries(Object.keys(r.questions.next_action.criteria).map((id,i)=>[id,i<2?0.26:0.01]));
  expect(()=>validateChoice(envelope,r)).toThrow('ambiguous_distribution');
});
it('compacts source report duplicates while preserving all catalog choices, facts and prior outcomes',()=>{
  const snapshot=new FixtureDomain().read('fixture-package');
  const catalog=Array.from({length:47},(_,i)=>({...rules[0],id:`rule-${i}`,implementationStatus:i%2?'implemented':'source_pending'}));
  const outcome={ruleId:'rule-0',subjectIds:['head-1'],status:'unknown',reason:'missing head positions',missingInputs:['head.position'],verificationState:'unresolved'};
  const sourceReport={catalog:[{discard:'duplicated-catalog-marker'}],sourceRefs:[{discard:'long-source-ref-marker'}],sources:[{discard:'duplicated-source-marker'}]};
  const r=ruleChoiceRequest(snapshot,snapshot.intent,catalog,{
    understanding:'Astra inspected saved geometry and needs spacing evidence.',
    ruleResults:[{result:{checks:[outcome],...sourceReport}}],
    savedInformation:{snapshot:{sourceDrawing:{drawingId:'drawing-1'},baselinePlan:{entities:[{id:'head-1',kind:'head',productId:'product-1',irrelevant:'unused-geometry-marker'}]},detailing:[{id:'detail-1',field:'height',value:3,unit:'m',subjectIds:['head-1'],confirmation:'confirmed',provenance:'measured',source:'sheet-A'}],siteFacts:[{id:'site-1',field:'access',value:null,unknownReason:'not measured'}],answers:[{requestId:'q1',answer:'unknown'}]},results:{checks:[outcome],...sourceReport}},
  });
  expect(Object.keys(r.questions.next_action.criteria)).toEqual([...catalog.map(rule=>rule.id),CLARIFY,SELECTION_DONE]);
  expect(r.questions.next_action.criteria['rule-0']).toContain('source_pending');
  expect(r.state.context).toMatchObject({understanding:'Astra inspected saved geometry and needs spacing evidence.',subjects:[{id:'head-1',kind:'head',productId:'product-1'}],facts:[{id:'detail-1',value:3,source:'sheet-A'},{id:'site-1',unknownReason:'not measured'}],answers:[{requestId:'q1',answer:'unknown'}],priorRuleOutcomes:[outcome]});
  const serialized=JSON.stringify(r);
  for(const marker of ['duplicated-catalog-marker','long-source-ref-marker','duplicated-source-marker','unused-geometry-marker']) expect(serialized).not.toContain(marker);
  expect(r.questions.next_action.criteria['rule-46']).toContain('source:1');
});

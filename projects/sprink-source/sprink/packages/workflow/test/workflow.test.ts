import {expect,it} from 'vitest';
import {WorkflowRunner} from '../src/runner.js';
import {type ChoiceRequest} from '../src/choice.js';
import {FixtureDomain,MemoryRunStore} from './fixtures/domain.js';
import {scriptedStream} from './fixtures/scripted-stream.js';
const rule={id:'spacing',version:'1',title:'Head spacing',check:'Measure spacing',applicability:'Applicable head family',subjectTypes:['head'],requiredInputs:['positions'],sourceRefs:[{documentId:'source:1',revision:'1',clauses:['clause 1']}],implementationStatus:'implemented',executionFunction:'spacing'};
const call=(name:string,args:Record<string,unknown>={})=>({name,arguments:args});
function setup(steps:ReturnType<typeof call>[], opts:{failure?:boolean;observe?:(context:unknown)=>void;maxSteps?:number}={}){
  const domain=Object.assign(new FixtureDomain(),{ruleCatalog:()=>[rule],inspect:()=>({documents:[] as {id:string}[],answer:'saved answer'})});
  const requests:ChoiceRequest[]=[];
  const runner=new WorkflowRunner({domain,store:new MemoryRunStore(),configVersion:'fixture-v1',maxSteps:opts.maxSteps,
    testStream:scriptedStream(steps,opts.observe),choice:{async choose(request){requests.push(request);if(opts.failure)throw new Error('network');return {...request.state,response:{model:request.model,answers:{next_action:{type:'choice',choice:'spacing',confidence:1,probabilities:{spacing:1,needs_clarification:0,selection_complete:0}}}}};}}});
  return {domain,runner,requests,start:()=>runner.start('fixture-package','prepare_from_drawing',domain.read('fixture-package')).done};
}
it('runs model tool decisions through Pi, returns detailed script results and feeds them back to JEV',async()=>{
  const contexts:unknown[]=[];
  const x=setup([call('inspect_saved_information',{kind:'sources'}),call('select_verification_rule',{context:'Investigated source'}),call('evaluate_work_package',{subjectId:'fixture-package',ruleId:'spacing'}),call('select_verification_rule',{context:'Result remains unknown due to source'}),call('finish_work',{status:'blocked',explanation:'Source pending; not approval'})],{observe:c=>contexts.push(c)});
  const r=await x.start();expect(r.status).toBe('blocked');expect(x.domain.calls[0].ruleId).toBe('spacing');expect(JSON.stringify(x.requests[1].state.context)).toContain('source_pending');expect(JSON.stringify(contexts)).toContain('findings');expect(r.explanation).toContain('not approval');
});
it('does not run unselected rules or convert JEV failure to fallback success',async()=>{
  const x=setup([call('select_verification_rule',{context:'check'})],{failure:true});const r=await x.start();expect(r.status).toBe('failed');expect(x.domain.calls).toHaveLength(0);expect(r.latestDecision).toBeUndefined();
});
it('requires investigation before asking and preserves a fresh revision on answer resume',async()=>{
  const q={id:'datum',text:'What remains unknown?',subjectId:'baseline-1',kind:'fact'};
  const x=setup([call('request_input',q),...['drawing','sources','results','answers'].map(kind=>call('inspect_saved_information',{kind})),call('request_input',q)]);
  const r=await x.start();expect(r.status).toBe('waiting_input');expect(r.steps).toBe(6);expect(r.question?.text).toBe(q.text);
  x.domain.answer(['joint_datum']);
  const next=new WorkflowRunner({domain:x.domain,store:new MemoryRunStore(),configVersion:'fixture-v1',choice:{async choose(){throw Error('unused');}},testStream:scriptedStream([call('inspect_saved_information',{kind:'answers'}),call('finish_work',{status:'blocked',explanation:'Saved answer investigated'})])});
  const resumed=await next.start('fixture-package','prepare_from_drawing',x.domain.read('fixture-package')).done;expect(resumed.inputRevision).toBe(2);expect(resumed.id).not.toBe(r.id);
});
it('enforces tool budget and version guard without picking a next action',async()=>{
  const x=setup([call('inspect_saved_information',{kind:'sources'}),call('finish_work',{status:'completed',explanation:'done'})],{maxSteps:1});expect((await x.start()).reason).toBe('step_limit');
  const y=setup([call('derive_work_package',{subjectId:'baseline-1'})],{observe:()=>y.domain.answer([])});expect((await y.start()).status).toBe('interrupted');expect(y.domain.calls).toHaveLength(0);
});
it('production without Astra credentials cannot fall back to a synthetic model',async()=>{
  const old=process.env.OPENAI_API_KEY;delete process.env.OPENAI_API_KEY;
  try{const domain=new FixtureDomain();const r=new WorkflowRunner({domain,store:new MemoryRunStore(),configVersion:'fixture-v1',choice:{async choose(){throw Error('unused')}}});expect((await r.start('fixture-package','prepare_from_drawing',domain.read('fixture-package')).done).status).toBe('failed');}finally{if(old!==undefined)process.env.OPENAI_API_KEY=old;}
});
it('refuses direct rule execution without a preceding JEV choice',async()=>{
  const x=setup([call('evaluate_work_package',{subjectId:'fixture-package',ruleId:'spacing'}),call('finish_work',{status:'blocked',explanation:'No rule selected'})]);
  expect((await x.start()).status).toBe('blocked');expect(x.domain.calls).toHaveLength(0);expect(x.requests).toHaveLength(0);
});
it('rejects completion claims without current artifacts',async()=>{
  const seen:unknown[]=[];const x=setup([call('finish_work',{status:'completed',explanation:'Everything passed'}),call('finish_work',{status:'blocked',explanation:'Missing artifacts'})],{observe:c=>seen.push(c)});
  const r=await x.start();expect(r.status).toBe('blocked');expect(JSON.stringify(seen)).toContain('Requested outputs are not yet available');
});
it.each(['needs_clarification','selection_complete'])('returns %s to Astra without a fixed fallback',async outcome=>{
  const domain=Object.assign(new FixtureDomain(),{ruleCatalog:()=>[rule]});const contexts:unknown[]=[];
  const runner=new WorkflowRunner({domain,store:new MemoryRunStore(),configVersion:'fixture-v1',testStream:scriptedStream([call('select_verification_rule',{context:'Inspect'}),call('finish_work',{status:'blocked',explanation:'Source remains unresolved'})],c=>contexts.push(c)),choice:{async choose(request){return {...request.state,response:{model:request.model,answers:{next_action:{type:'choice',choice:outcome,confidence:1,probabilities:{spacing:0,needs_clarification:outcome==='needs_clarification'?1:0,selection_complete:outcome==='selection_complete'?1:0}}}}};}}});
  const r=await runner.start('fixture-package','prepare_from_drawing',domain.read('fixture-package')).done;
  expect(r.status).toBe('blocked');expect(domain.calls).toHaveLength(0);expect(r.question).toBeUndefined();expect(JSON.stringify(contexts)).toContain(outcome==='needs_clarification'?'needs_information':'selection_complete');
});
it.each(['cancel','input_edit'])('prevents late publication after %s',async mode=>{
  const x=setup([call('derive_work_package',{subjectId:'baseline-1'})]);
  let entered!:()=>void;const started=new Promise<void>(resolve=>entered=resolve);
  let complete!:(result:{summary:string;payload:unknown})=>void;
  x.domain.execute=async()=>{entered();return new Promise(resolve=>complete=resolve);};
  const running=x.start();await started;
  if(mode==='cancel') x.runner.cancel('fixture-package');else x.domain.answer([]);
  complete({summary:'late result',payload:{test:true}});
  const result=await running;
  expect(result.status).toBe(mode==='cancel'?'cancelled':'interrupted');expect(x.domain.data.snapshot.outputs).toHaveLength(0);
});
it('does not treat a source index as inspection of registered source text',async()=>{
  const q={id:'missing',text:'Unknown source input?',subjectId:'baseline-1',kind:'fact'};
  const seen:unknown[]=[];
  const x=setup([...['drawing','sources','results','answers'].map(kind=>call('inspect_saved_information',{kind})),call('request_input',q),call('inspect_saved_information',{kind:'sources',query:'head spacing'}),call('request_input',q)],{observe:c=>seen.push(c)});
  x.domain.inspect=()=>({documents:[{id:'doc-1'}],passages:[],answer:'saved answer'});
  const result=await x.start();expect(result.status).toBe('waiting_input');expect(result.steps).toBe(7);expect(JSON.stringify(seen)).toContain('missingInspections');
});
it('rejects candidate adoption questions before current comparisons exist',async()=>{
  const x=setup([...['drawing','sources','results','answers'].map(kind=>call('inspect_saved_information',{kind})),call('request_input',{id:'adopt',text:'Which alternative?',subjectId:'candidate-1',kind:'candidate_selection'}),call('finish_work',{status:'blocked',explanation:'Comparison absent'})]);
  const result=await x.start();expect(result.status).toBe('blocked');expect(result.question).toBeUndefined();
});
it('requires evaluations for the current plan rather than any current result',async()=>{
  const x=setup([call('finish_work',{status:'completed',explanation:'All requested results exist'}),call('finish_work',{status:'blocked',explanation:'Selected plan remains unevaluated'})]);
  x.domain.data.snapshot.selectedPlanId='candidate-a';
  x.domain.data.snapshot.outputs=[{id:'p',kind:'package',subjectId:'candidate-a',inputRevision:1,configVersion:'fixture-v1'},{id:'e',kind:'evaluation',subjectId:'baseline-1',inputRevision:1,configVersion:'fixture-v1'}];
  expect((await x.start()).status).toBe('blocked');
});
it('returns the existing result for a repeated selected rule without rerunning unchanged scripts',async()=>{
  const contexts:unknown[]=[];
  const x=setup([call('select_verification_rule',{context:'first'}),call('evaluate_work_package',{ruleId:'spacing',subjectId:'fixture-package'}),call('select_verification_rule',{context:'same inputs'}),call('evaluate_work_package',{ruleId:'spacing',subjectId:'fixture-package'}),call('finish_work',{status:'blocked',explanation:'Unknowns remain'})],{observe:c=>contexts.push(c)});
  const r=await x.start();expect(r.status).toBe('blocked');expect(x.domain.calls).toHaveLength(1);expect(x.requests).toHaveLength(2);expect(JSON.stringify(contexts)).toContain('noProgress');expect(JSON.stringify(contexts)).toContain('source_pending');
});
it('returns allowed verification targets without consuming JEV selection for an invalid target',async()=>{
  const contexts:unknown[]=[];
  const x=setup([call('select_verification_rule',{context:'Verify geometry'}),call('evaluate_work_package',{ruleId:'spacing',subjectId:'duct-conflict'}),call('evaluate_work_package',{ruleId:'spacing',subjectId:'fixture-package'}),call('finish_work',{status:'blocked',explanation:'Missing source'})],{observe:c=>contexts.push(c)});
  const result=await x.start();expect(result.status).toBe('blocked');expect(x.requests).toHaveLength(1);expect(x.domain.calls).toHaveLength(1);expect(x.domain.calls[0].subjectId).toBe('fixture-package');expect(JSON.stringify(contexts)).toContain('allowedSubjectIds');
});
it('preserves adopted candidate geometry by refusing replacement candidate generation',async()=>{
  const contexts:unknown[]=[];
  const x=setup([call('generate_change_candidates',{subjectId:'duct-conflict'}),call('derive_work_package',{subjectId:'candidate-a'}),call('finish_work',{status:'blocked',explanation:'Selected plan derived; missing source'})],{observe:c=>contexts.push(c)});
  x.domain.data.snapshot.selectedPlanId='candidate-a';
  const result=await x.start();expect(result.status).toBe('blocked');expect(x.domain.calls.map(action=>action.operation)).toEqual(['derive_work_package']);expect(x.domain.data.snapshot.selectedPlanId).toBe('candidate-a');expect(JSON.stringify(contexts)).toContain('user must clear selection');
});

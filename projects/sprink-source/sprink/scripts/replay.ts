import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sceneSvg } from '../apps/server/src/drawing.js';
import { emptyFacts, type HeadFacts } from '../packages/core/src/index.js';

const base=process.env.SPRINK_URL??'http://127.0.0.1:4310';
const token=process.env.SPRINK_TOKEN??readFileSync(resolve(process.env.SPRINK_DATA_DIR??'.data','access-token'),'utf8').trim();
const headers={Authorization:`Bearer ${token}`};
async function call(path:string,body?:unknown){const response=await fetch(`${base}/api${path}`,body===undefined?{headers}:{method:'POST',headers:{...headers,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:JSON.stringify(body)});if(!response.ok)throw new Error(`${response.status}: ${await response.text()}`);return response.json();}
const task=await call('/tasks',{title:'合成リプレイ：欠測 → 追加撮影 → 検証'});
async function upload(id:string,orientation:string){const form=new FormData();form.set('metadata',JSON.stringify({id,targetId:'H1',capturedAt:new Date().toISOString(),source:'fixture',synthetic:true}));form.set('image',new Blob([sceneSvg(orientation)],{type:'image/svg+xml'}),'fixture.svg');const response=await fetch(`${base}/api/tasks/${task.id}/observations`,{method:'POST',headers,body:form});if(!response.ok)throw new Error(await response.text());return response.json();}
await upload('wide','unknown');
let current=await call(`/tasks/${task.id}`);const initial=emptyFacts();
// Explicit synthetic records exercise the API; these values are not read from the scene image.
const syntheticValues={model:'TY3231',installation:'installed',mounting:'standard',bulbCondition:'intact',
  installationWrench:'w_type_6',threadStandard:'npt',installationTorqueFtLb:10,fieldFinish:'factory_only',
  leakage:'absent',corrosion:'absent',workingPressurePsi:100,pressureBasis:'system_maximum'} as const;
for(const [key,value] of Object.entries(syntheticValues))
  (initial as unknown as Record<string,unknown>)[key]={value,confirmed:true,evidenceIds:['wide'],source:'manual'};
await call(`/tasks/${task.id}/facts`,{baseRevision:current.revision,facts:initial});
const missing=await call(`/tasks/${task.id}/validate`,{});
if(missing.rule.status!=='unknown')throw new Error('Expected unknown before detail image');
const request=await call(`/tasks/${task.id}/requests`,{kind:'capture',reason:'向きと重力基準が同時に確認できる写真を追加してください',fields:['orientation','verticalReference']});
await upload('detail','pendent');current=await call(`/tasks/${task.id}`);
const facts:Partial<HeadFacts>={orientation:{value:'pendent',confirmed:true,evidenceIds:['detail'],source:'manual'},verticalReference:{value:'verified_record',confirmed:true,evidenceIds:['detail'],source:'manual'}};
await call(`/tasks/${task.id}/facts`,{baseRevision:current.revision,facts});
const answer={id:randomUUID(),requestId:request.id,observationIds:['detail']};
await call(`/tasks/${task.id}/answers`,answer);await call(`/tasks/${task.id}/answers`,answer);
await call(`/tasks/${task.id}/measurements`,{id:'fixture-length',targetId:'H1',unit:'m',method:'fixture',evidenceIds:['wide','detail'],from:{coordinateFrameId:'fixture',captureSessionId:'fixture',timestamp:0,position:[0,0,0],hit:'fixture',tracking:'normal',evidenceIds:['wide']},to:{coordinateFrameId:'fixture',captureSessionId:'fixture',timestamp:1,position:[2,0,0],hit:'fixture',tracking:'normal',evidenceIds:['detail']}});
const artifact=await call(`/tasks/${task.id}/artifact`,{});
if(artifact.validation.rule.status!=='pass'||!artifact.synthetic||artifact.validation.rules.some((rule:{status:string})=>!['pass','not_applicable'].includes(rule.status)))throw new Error('Unexpected final replay result');
console.log(JSON.stringify({taskId:task.id,url:base,rules:artifact.validation.rules.map((rule:{ruleId:string;status:string})=>({id:rule.ruleId,status:rule.status})),synthetic:artifact.synthetic,measurementAccuracy:artifact.validation.measurements[0].accuracy,artifactId:artifact.id},null,2));

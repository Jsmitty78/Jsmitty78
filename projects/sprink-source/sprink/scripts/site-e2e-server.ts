import { readFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { FieldService } from '../apps/server/src/service.js';
import { WorkPackageStore } from '../apps/server/src/work-packages/store.js';
import { createIntegratedServices } from '../apps/server/src/integration/runtime.js';
import { createApp } from '../apps/server/src/api.js';
import { workflowLlmFromEnv, JevHttpClient } from '../packages/workflow/src/index.js';
import { JevSourceSearch } from '../apps/server/src/sources/semantic.js';

const token=process.env.E2E_TOKEN;
if(!token)throw Error('E2E_TOKEN required');
const directory=resolve(process.env.E2E_DATA_DIR??'e2e-out/site-change/server');mkdirSync(directory,{recursive:true});
const env=parseEnv(readFileSync('.env.local','utf8')),key=env.TYPESAFE_API_KEY??process.env.TYPESAFE_API_KEY;
if(!key)throw Error('JEV credential required');
const llm=workflowLlmFromEnv(process.env,env),field=new FieldService(directory);
// Preserve the ceiling across restarts, including older logs whose counter restarted at zero.
const eventPath=join(directory,'events.jsonl');
let spent=0, previous=0;
if(existsSync(eventPath))for(const line of readFileSync(eventPath,'utf8').split('\n').filter(Boolean)) {
  const event=JSON.parse(line);
  if(typeof event.costDelta==='number') spent+=event.costDelta;
  else if(typeof event.spent==='number') { spent+=event.spent>=previous?event.spent-previous:event.spent;previous=event.spent; }
}
const budget=Number(process.env.E2E_BUDGET_USD??8);
if(!(budget>0&&budget<=100))throw Error('Budget must be >0 and <=100');
const offline=process.env.E2E_OFFLINE==='1'||spent>=budget;
const networkFetch=globalThis.fetch;
globalThis.fetch=(...args)=> { if(process.env.E2E_FAILURE_FILE && existsSync(process.env.E2E_FAILURE_FILE) && (!process.env.E2E_FAILURE_MATCH || String(args[0] instanceof Request ? args[0].url : args[0]).includes(process.env.E2E_FAILURE_MATCH))) return Promise.reject(Error('E2E injected provider outage')); if(offline||spent>=budget)return Promise.reject(Error('External calls disabled: offline inspection or cumulative budget reached'));return networkFetch(...args); };
if(offline)console.log('OFFLINE: no external calls; cumulative metered cost',spent);
const log=(data:unknown)=>appendFileSync(join(directory,'events.jsonl'),JSON.stringify({time:new Date().toISOString(),...data as object})+'\n',{mode:0o600});
const sourceSearch=new JevSourceSearch(key);
const integrated=createIntegratedServices(new WorkPackageStore(field.store.db),directory,{llm,sourceSearch,choice:new JevHttpClient(key),onEvent:(runId,event)=>{
  if(event.type==='tool_execution_start')log({runId,event:event.type,tool:event.toolName,...(['save_reading_proposal','evaluate_work_package','request_input'].includes(event.toolName)?{args:event.args}:{})});
  if(event.type==='tool_execution_end')log({runId,event:event.type,tool:event.toolName,error:event.isError,...(['select_verification_rule','evaluate_work_package'].includes(event.toolName)?{result:event.result}: {})});
  if(event.type==='message_end'&&event.message.role==='assistant'){
    spent+=event.message.usage.cost.total;log({runId,event:event.type,model:event.message.model,stopReason:event.message.stopReason,...(event.message.errorMessage?{errorMessage:event.message.errorMessage}:{}),costDelta:event.message.usage.cost.total,spent,budget});
    if(spent>=budget)for(const p of integrated.packages.list())if(p.run?.status==='running')integrated.packages.cancel(p.id,p.run.id);
  }
}});
const app=createApp(field,{token,workPackages:integrated.packages,workPackageExports:integrated.exports,workPackageDetails:integrated.details,sourceSearch,webDir:resolve('apps/web/dist')});
const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port:Number(process.env.E2E_PORT??4329)},()=>console.log('Site E2E server ready; real Pi/JEV, isolated database; metered model limit',budget));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close();integrated.packages.close();field.store.close();process.exit(0);});

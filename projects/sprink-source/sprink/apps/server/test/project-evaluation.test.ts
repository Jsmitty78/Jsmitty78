import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FieldService } from '../src/service.js';
import { createApp } from '../src/api.js';

const token='project-evaluation-test-token';
const directories:string[]=[],services:FieldService[]=[];
function setup(){
  const dir=mkdtempSync(join(tmpdir(),'field-project-evaluation-'));
  directories.push(dir);
  const service=new FieldService(dir);services.push(service);
  return createApp(service,{token});
}
afterEach(()=>{
  for(const service of services.splice(0))if(service.store.db.open)service.store.close();
  for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});
});
const request=(body:unknown)=>({
  method:'POST',
  headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},
  body:JSON.stringify(body),
});
const emptyInput={project:{id:'p-1',revision:0,asOf:'2026-09-26'},selectedRulePacks:[]};

describe('stateless project-rule API',()=>{
  it('evaluates the same explicit JSON contract without a Pi runner or aggregate verdict',async()=>{
    const app=setup();
    const response=await app.request('/api/rules/evaluate',request(emptyInput));
    expect(response.status).toBe(200);
    const result=await response.json();
    expect(result).toMatchObject({projectId:'p-1',taskRevision:0,rules:[],missingInputs:[]});
    expect(result).not.toHaveProperty('status');
  });

  it('returns HTTP 400 for an unknown selected pack',async()=>{
    const app=setup();
    const response=await app.request('/api/rules/evaluate',request({...emptyInput,selectedRulePacks:['not-a-pack']}));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({error:expect.any(String)});
  });

  it('retains the API authentication boundary',async()=>{
    const app=setup();
    const response=await app.request('/api/rules/evaluate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(emptyInput)});
    expect(response.status).toBe(401);
  });
});

import { planSvg } from '../src/drawing.js';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FieldService } from '../src/service.js';
import { createApp } from '../src/api.js';
const dirs:string[]=[],services:FieldService[]=[];
const setup=()=>{const dir=mkdtempSync(join(tmpdir(),'drawing-test-'));dirs.push(dir);const s=new FieldService(dir);services.push(s);return s;};
afterEach(()=>{services.splice(0).forEach(s=>{if(s.store.db.open)s.store.close();});dirs.splice(0).forEach(dir=>rmSync(dir,{recursive:true,force:true}));});
describe('drawing persistence and comparison',()=>{
  it('persists the real reference drawing and changed pipe sizes with source metadata',()=>{
    const s=setup(),t=s.createTask({reference:true});
    const d=t.plan.drawing!;expect(d.heads).toHaveLength(19);expect(d.pipes).toHaveLength(41);
    d.pipes[0]!.diameter=100;delete d.pipes[0]!.nominalInches;
    const saved=s.updateDrawing(t.id,d,t.revision),loaded=s.getTask(t.id);
    expect(loaded.plan.drawing).toEqual(d);expect(planSvg(loaded.plan)).toContain('P1 · DN100');
    expect(loaded.plan.drawing?.source?.sha256).toBe(d.source?.sha256);expect(saved.revision).toBe(t.revision+1);
  });
  it('updates geometry atomically, syncs target and length, invalidates old artifacts and survives restart',async()=>{
    let s=setup();const task=s.createTask();await s.replay(task.id,'normal');s.prepareArtifact(task.id);
    s.requestEvidence(task.id,{kind:'capture',fields:['orientation'],reason:'check'});
    const current=s.getTask(task.id),d=current.plan.drawing!;
    d.nodes.find(n=>n.id==='N1')!.y=1500;d.heads[0]!.orientation='upright';
    const updated=s.updateDrawing(task.id,d,current.revision,'save-1');
    expect(updated.plan.lengthMeters).toBe(2.5);expect(updated.plan.orientation).toBe('upright');
    expect(planSvg(updated.plan)).toContain('2,500');expect(updated.artifact).toBeNull();
    expect(updated.requests[0]!.status).toBe('superseded');expect(updated.validation?.comparison.status).toBe('different');
    expect(s.updateDrawing(task.id,d,current.revision,'save-1').revision).toBe(updated.revision);
    expect(()=>s.updateDrawing(task.id,d,current.revision,'save-2')).toThrow('更新');
    const dir=s.dataDir;s.store.close();s=new FieldService(dir);services.push(s);
    expect(s.getTask(task.id).plan).toEqual(updated.plan);
  });
  it('migrates legacy display without modifying evidence or stored revisions',()=>{
    const s=setup(),t=s.createTask();delete t.plan.drawing;s.store.save(t);
    const loaded=s.getTask(t.id);expect(loaded.plan.drawing?.heads).toHaveLength(6);expect(loaded.revision).toBe(t.revision);
    expect(loaded.observations).toEqual(t.observations);
  });
  it('rejects bad geometry, changed target model and cancelled updates without writes',async()=>{
    const s=setup(),t=s.createTask(),token='drawing-test-token',app=createApp(s,{token});
    const d=t.plan.drawing!;d.pipes[0]!.to='missing';
    const response=await app.request(`/api/tasks/${t.id}/drawing`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({drawing:d,baseRevision:t.revision})});
    expect(response.status).toBe(400);expect(s.getTask(t.id).revision).toBe(t.revision);
    const valid=s.getTask(t.id).plan.drawing!;valid.heads[0]!.model='other';
    expect(()=>s.updateDrawing(t.id,valid,t.revision)).toThrow('型式');
    valid.heads[0]!.model='TY3231';s.cancel(t.id);
    expect(()=>s.updateDrawing(t.id,valid,s.getTask(t.id).revision)).toThrow('キャンセル');
  });
});

describe('compact drawing transport and persistence',()=>{
  it('keeps reference polling and idempotency records small and exports SVG only on demand',async()=>{
    const s=setup(),token='drawing-size-test',app=createApp(s,{token});
    const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'};
    const input={id:'reference-payload',reference:true};
    const created=await app.request('/api/tasks',{method:'POST',headers,body:JSON.stringify(input)});
    expect(created.status).toBe(201);
    for(const response of [created,await app.request('/api/tasks/reference-payload',{headers}),await app.request('/api/tasks',{method:'POST',headers,body:JSON.stringify(input)})]) {
      const body=await response.text();expect(Buffer.byteLength(body)).toBeLessThan(20000);
      expect(JSON.parse(body).plan.svg).toBeUndefined();
    }
    const stored=s.store.db.prepare('SELECT data FROM tasks').get() as {data:string};
    const operation=s.store.db.prepare('SELECT result FROM operations').get() as {result:string};
    expect(Buffer.byteLength(stored.data)).toBeLessThan(20000);expect(Buffer.byteLength(operation.result)).toBeLessThan(20000);
    expect((await app.request('/api/tasks/reference-payload/drawing.svg')).status).toBe(401);
    const svg=await app.request('/api/tasks/reference-payload/drawing.svg',{headers});
    expect(svg.status).toBe(200);expect(svg.headers.get('Content-Type')).toContain('image/svg+xml');
    expect(await svg.text()).toBe(planSvg(s.getTask(input.id).plan));
    expect(s.store.listSummaries()).toEqual(s.listTasks());
  });
  it('exports a self-contained artifact without putting its SVG back into polls or storage',async()=>{
    const s=setup(),t=s.createTask({reference:true});await s.replay(t.id,'normal');s.prepareArtifact(t.id);
    const task=s.getTask(t.id);expect(task.artifact).not.toBeNull();
    expect(task.plan).not.toHaveProperty('svg');expect(task.artifact!.plan).not.toHaveProperty('svg');
    const app=createApp(s,{token:'artifact-export-test-token'});
    const response=await app.request(`/api/tasks/${t.id}/artifact`,{headers:{Authorization:'Bearer artifact-export-test-token'}});
    expect(response.status).toBe(200);const artifact=await response.json();
    expect(artifact.plan.svg).toBe(planSvg(task.artifact!.plan));
    expect(s.getTask(t.id).artifact!.plan).not.toHaveProperty('svg');
    expect(JSON.stringify(task)).not.toContain('<svg');
  });
  it('migrates duplicated historical SVGs while preserving revisions, evidence and retry hashes',async()=>{
    let s=setup();const t=s.createTask();await s.replay(t.id,'normal');s.prepareArtifact(t.id);
    const original=s.getTask(t.id),legacy=JSON.parse(JSON.stringify(original));
    legacy.plan.svg=planSvg(original.plan);legacy.artifact.plan.svg=legacy.plan.svg;
    s.store.db.prepare('UPDATE tasks SET data=? WHERE id=?').run(JSON.stringify(legacy),t.id);
    s.store.operation(t.id,'legacy-task',{kind:'task'},()=>legacy);
    s.store.operation(t.id,'legacy-artifact',{kind:'artifact'},()=>legacy.artifact);
    const before=s.store.db.prepare('SELECT id,hash FROM operations ORDER BY id').all();
    s.store.db.pragma('user_version=1');const dir=s.dataDir;s.store.close();s=new FieldService(dir);services.push(s);
    expect(s.getTask(t.id)).toEqual(original);
    expect(s.store.db.prepare('SELECT id,hash FROM operations ORDER BY id').all()).toEqual(before);
    expect(s.store.operation(t.id,'legacy-task',{kind:'task'},()=>{throw new Error('must not rerun');})).toEqual(original);
    expect(s.store.operation(t.id,'legacy-artifact',{kind:'artifact'},()=>{throw new Error('must not rerun');})).toEqual(original.artifact);
    expect(()=>s.store.operation(t.id,'legacy-task',{kind:'different'},()=>null)).toThrow('同じ操作ID');
    const stored=s.store.db.prepare('SELECT data FROM tasks').get() as {data:string};expect(stored.data).not.toContain('<svg');
    s.store.close();s=new FieldService(dir);services.push(s);expect(s.getTask(t.id)).toEqual(original);
  });
});

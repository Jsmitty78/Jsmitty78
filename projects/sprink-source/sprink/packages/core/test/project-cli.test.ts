import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const directories:string[]=[];
afterEach(()=>{for(const dir of directories.splice(0))rmSync(dir,{recursive:true,force:true});});
const input={project:{id:'cli-project',revision:2,asOf:'2026-09-26'},selectedRulePacks:[]};
function run(args:string[],stdin=''){
  return spawnSync(process.execPath,['--import','tsx','scripts/evaluate-project.ts',...args],{
    cwd:root,input:stdin,encoding:'utf8',
  });
}

describe('project-rule JSON CLI',()=>{
  it('accepts the API JSON contract from stdin',()=>{
    const result=run(['-'],JSON.stringify(input));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({projectId:'cli-project',taskRevision:2,rules:[]});
  });

  it('accepts a JSON file as `pnpm rules:evaluate <input.json>` does',()=>{
    const dir=mkdtempSync(resolve(tmpdir(),'field-project-cli-'));directories.push(dir);
    const path=resolve(dir,'input.json');writeFileSync(path,JSON.stringify(input));
    const result=run([path]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({projectId:'cli-project',taskRevision:2});
  });

  it('reports invalid input as JSON on stderr with a failing exit status',()=>{
    const result=run(['-'],JSON.stringify({...input,selectedRulePacks:['not-a-pack']}));
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stderr)).toMatchObject({code:'unknown_pack'});
    expect(result.stdout).toBe('');
  });
});

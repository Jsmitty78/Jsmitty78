/** Real-provider negative/recovery scenarios on an existing UI-created package. */
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.E2E_BASE??'http://127.0.0.1:4329',token=process.env.E2E_TOKEN,id=process.env.E2E_PACKAGE,out=process.env.E2E_OUT??'e2e-out/site-recovery';
if(!token||!id)throw Error('E2E_TOKEN and E2E_PACKAGE required');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chromium'}),ctx=await browser.newContext({viewport:{width:1440,height:1000}}),page=await ctx.newPage();const report={checks:[],errors:[],packageId:id};
const check=(name,ok)=>{assert(ok,name);report.checks.push(name);console.log('PASS',name);};
const read=async()=>{const r=await ctx.request.get(`${base}/api/work-packages/${id}`,{headers:{Authorization:`Bearer ${token}`}});assert(r.ok());return r.json();};
const wait=async predicate=>{for(let i=0;i<600;i++){const s=await read();if(predicate(s))return s;if(s.run?.status==='failed')throw Error(s.run.stopReason);await page.waitForTimeout(500);}throw Error('Timed out');};
const open=async()=>{const d=page.locator('details').filter({has:page.locator('summary',{hasText:'測定と不足情報'})}).first();await d.waitFor();if(await d.getAttribute('open')===null)await d.locator('summary').first().click();};
const measure=async(field,value)=>{await open();await page.getByLabel('Measurement field').selectOption(field);await page.getByLabel('測定できない',{exact:true}).setChecked(value===null);if(value!==null)await page.getByLabel('Measurement value').fill(String(value));await page.getByLabel('Measurement reason').fill(value===null?'Synthetic case: height inaccessible, do not infer':'Synthetic recovery oracle');await page.getByLabel('検証用の仮定',{exact:true}).check();await page.getByLabel('入力値と根拠を確認した').check();const rev=(await read()).inputRevision;await page.getByRole('button',{name:'測定結果を保存',exact:true}).click();await wait(s=>s.inputRevision>rev);await page.reload();await open();};
const start=async()=>{const prev=(await read()).run?.id;await open();await page.getByRole('button',{name:'保存した情報でPiを再開',exact:true}).click();return wait(s=>s.run?.id!==prev&&s.run?.status!=='running');};
try{
 await page.goto(base);await page.locator('input[type=password]').fill(token);await page.locator('input[type=password]').press('Enter');await page.getByRole('button',{name:'English',exact:true}).click();await page.getByText((await read()).title,{exact:true}).click();
 if((await read()).selectedPlan){const rev=(await read()).inputRevision;await page.getByRole('button',{name:'Clear selection',exact:true}).click();await wait(s=>s.inputRevision>rev);await page.reload();}
 await measure('requiredPipeClearance',2000);let s=await start();
 check('Bounded search reports no candidates',s.outputs.candidates?.inputRevision===s.inputRevision&&s.outputs.candidates.candidates.length===0);check('Rejected alternatives retain reasons',s.outputs.candidates.rejected.length>0);
 await page.screenshot({path:`${out}/no-candidates.png`,fullPage:true});
 await measure('duct.max.z',null);s=await start();check('Unknown height not manufactured',s.siteFacts.find(f=>f.field==='duct.max.z').value===null);check('Unavailable height is not asked again unchanged',!s.outputs.requests.some(r=>r.inputRevision===s.inputRevision&&/duct.max.z|height/i.test(r.question)));check('No current usable routes with missing height',!s.outputs.candidates||s.outputs.candidates.inputRevision!==s.inputRevision||s.outputs.candidates.candidates.length===0);
 await writeFile(`${out}/missing-height.json`,JSON.stringify(s,null,2));
 await measure('duct.max.z',300);await measure('requiredPipeClearance',100);
 const prev=(await read()).run?.id;await page.getByRole('button',{name:'保存した情報でPiを再開',exact:true}).click();await wait(s=>s.run?.id!==prev);await measure('fittingEnvelopeRadius',100);s=await read();check('Editing interrupts the active run',s.run?.status==='interrupted'||s.run?.status==='cancelled');const revision=s.inputRevision;await page.waitForTimeout(2000);s=await read();check('Late run result is not published as current',s.inputRevision===revision&&!s.outputs.results.some(r=>r.inputRevision===revision));
 s=await start();check('Corrected inputs regenerate routes',s.outputs.candidates?.inputRevision===s.inputRevision&&s.outputs.candidates.candidates.length===2);await page.screenshot({path:`${out}/recovered.png`,fullPage:true});await writeFile(`${out}/snapshot.json`,JSON.stringify(s,null,2));
 const detail=await ctx.request.get(`${base}/api/work-packages/${id}/detail`,{headers:{Authorization:`Bearer ${token}`}});await writeFile(`${out}/detail.json`,JSON.stringify(await detail.json(),null,2));
}catch(e){report.errors.push(String(e));process.exitCode=1;console.error(e);await page.screenshot({path:`${out}/failure.png`,fullPage:true});}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}

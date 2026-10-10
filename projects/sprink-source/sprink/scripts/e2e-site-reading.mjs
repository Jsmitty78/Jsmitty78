/** Real Pi reads a rotated, ambiguous fixture. All changes are made through UI. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.E2E_BASE??'http://127.0.0.1:4329',token=process.env.E2E_TOKEN,out=process.env.E2E_OUT??'e2e-out/site-reading';
if(!token)throw Error('E2E_TOKEN required');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chromium'}),context=await browser.newContext(),page=await context.newPage();
let id;const report={checks:[],errors:[]},check=(name,ok)=>{assert(ok,name);report.checks.push(name);console.log('PASS',name);};
const read=async()=>{const r=await context.request.get(`${base}/api/work-packages/${id}`,{headers:{Authorization:`Bearer ${token}`}});assert(r.ok());return r.json();};
const wait=async fn=>{for(let n=0;n<300;n++){const s=await read();if(fn(s))return s;if(s.run?.status==='failed')throw Error(s.run.stopReason);await page.waitForTimeout(500);}throw Error('Read timed out');};
try{
 await page.goto(base);await page.locator('input[type=password]').fill(token);await page.locator('input[type=password]').press('Enter');await page.getByRole('button',{name:'English',exact:true}).click();
 if(!process.env.E2E_RESUME){await page.getByLabel('Adapt to site conditions name').fill(`Rotated reading ${Date.now()}`);const created=page.waitForResponse(r=>r.url().endsWith('/api/work-packages')&&r.request().method()==='POST');await page.locator('form.fa-entry-card').nth(1).locator('button[type=submit]').click();id=(await(await created).json()).id;report.packageId=id;
 await page.getByLabel('Evidence role').selectOption('site');await page.getByLabel('検証用の架空資料（実測として扱わない）').check();await page.getByLabel('Add site evidence').setInputFiles('fixtures/site-change/ambiguous-rotated.png');await wait(s=>s.siteWork?.evidence.length===1);
 await page.getByLabel('Reading instruction').fill('Read each of the three dimension labels. Propose each field even if unreadable; unknown values must be null and uncertain. Do not infer missing digits. English notes.');await page.getByRole('button',{name:'AIで読み取る',exact:true}).click();await wait(s=>s.siteWork?.readings.length===1);}else{id=process.env.E2E_RESUME;report.packageId=id;await page.getByText((await read()).title,{exact:true}).click();}
 let s=await read();const reading=s.siteWork.readings.at(-1),item=reading.items.find(i=>i.field==='duct.max.z');
 check('Real AI reads rotated explicit dimension',reading.items.some(i=>i.field==='duct.min.z'&&i.value===-300));check('Unreadable digit is unknown',item?.value===null&&item.uncertain);check('Absent measurement is unknown',!reading.items.some(i=>i.field==='workEnvelope.max.z'&&i.value!==null));
 await page.getByLabel(`Reading value ${item.id}`).fill('300');await page.getByLabel(`Reading field ${item.id}`).selectOption('duct.max.y');await page.getByLabel(`Reading field ${item.id}`).selectOption('duct.max.z');const row=page.getByLabel(`Reading value ${item.id}`).locator('xpath=ancestor::fieldset');await row.getByText('位置を修正',{exact:true}).click();await page.getByLabel(`Point ${item.id} 0 x`,{exact:true}).fill('0.5');await page.getByLabel('Reading reviewer').fill('Human correction from independent clarification: 300 mm, synthetic');
 const rev=s.inputRevision;await page.getByRole('button',{name:'選択項目を確認して保存',exact:true}).click();s=await wait(s=>s.inputRevision>rev);await page.reload();
 check('Human correction saved',s.siteFacts.some(f=>f.field==='duct.max.z'&&f.value===300&&f.provenance==='synthetic_assumption'));
 check('Unconfirmed dimension not converted to fact',!s.siteFacts.some(f=>f.field==='workEnvelope.max.z'&&f.value!==null));check('Original proposal retained for audit',s.siteWork.readings.at(-1).originalItems.some(i=>i.id===item.id&&i.value===null));
 check('Human location and target correction saved',s.siteWork.readings.at(-1).items.find(i=>i.id===item.id).points[0].x===0.5&&s.siteWork.readings.at(-1).items.find(i=>i.id===item.id).field==='duct.max.z');
 await page.screenshot({path:`${out}/corrected-reading.png`,fullPage:true});await writeFile(`${out}/snapshot.json`,JSON.stringify(s,null,2));
}catch(e){report.errors.push(String(e));process.exitCode=1;console.error(e);await page.screenshot({path:`${out}/failure.png`,fullPage:true});}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}

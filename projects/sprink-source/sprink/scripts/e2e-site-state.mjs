/** Browser state/recovery checks on a previously UI-created package. No AI calls.
 * This does not replace the fresh real-provider acceptance flow. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const base=process.env.E2E_BASE??'http://127.0.0.1:4329',token=process.env.E2E_TOKEN,id=process.env.E2E_PACKAGE;
if(!token||!id)throw Error('E2E_TOKEN and E2E_PACKAGE required');
const out=process.env.E2E_OUT??'e2e-out/site-state';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chromium'}),context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage(),report={packageId:id,checks:[],errors:[]};
const check=(name,ok)=>{assert(ok,name);report.checks.push(name);console.log('PASS',name);};
const read=async()=>{const r=await context.request.get(`${base}/api/work-packages/${id}`,{headers:{Authorization:`Bearer ${token}`}});assert(r.ok());return r.json();};
const wait=async predicate=>{for(let i=0;i<60;i++){const s=await read();if(predicate(s))return s;await page.waitForTimeout(250);}throw Error('Timed out waiting for saved state');};
const open=async(p,title)=>{const d=p.locator('details').filter({has:p.locator('summary',{hasText:title})}).first();await d.waitFor();if(await d.getAttribute('open')===null)await d.locator('summary').first().click();};
const measurement=async(p,value,reason)=>{await open(p,'測定と不足情報');await p.getByLabel('Measurement field').selectOption('fittingEnvelopeRadius');await p.getByLabel('Measurement value').fill(String(value));await p.getByLabel('Measurement reason').fill(reason);await p.getByLabel('検証用の仮定',{exact:true}).check();await p.getByLabel('入力値と根拠を確認した').check();};
try{
 await page.goto(base);await page.locator('input[type=password]').fill(token);await page.locator('input[type=password]').press('Enter');await page.getByRole('button',{name:'English',exact:true}).click();
 const initial=await read();await page.getByText(initial.title,{exact:true}).click();
 await page.locator('svg[aria-label="Plan view of the run"] .fa-pipe').first().waitFor({state:'attached'});
 check('Baseline and generated pipe segments render',await page.locator('svg[aria-label="Plan view of the run"] .fa-pipe').count()>=5);
 await open(page,'断面（配管方向 X／高さ Z）');await page.getByRole('img',{name:'Site X Z section',exact:true}).waitFor();
 check('Section draws saved X/Z geometry',await page.locator('svg[aria-label="Site X Z section"] line').count()>=5);
 await page.screenshot({path:join(out,'rendered-routes.png'),fullPage:true});
 const other=await context.newPage();await other.goto(base);await other.locator('input[type=password]').fill(token);await other.locator('input[type=password]').press('Enter');await other.getByText(initial.title,{exact:true}).click();
 await measurement(other,101,'Stale competing synthetic edit');
 await measurement(page,100,'First synthetic edit wins');let rev=(await read()).inputRevision;
 await page.getByRole('button',{name:'測定結果を保存',exact:true}).click();await wait(s=>s.inputRevision===rev+1);
 const rejected=other.waitForResponse(r=>r.url().endsWith('/measurements')&&r.request().method()==='POST');await other.getByRole('button',{name:'測定結果を保存',exact:true}).click();
 check('Concurrent stale edit is rejected',(await rejected).status()===409);
 check('Competing value not saved',(await read()).siteFacts.find(f=>f.field==='fittingEnvelopeRadius').value===100);await other.close();
 await page.getByLabel('Measurement field').selectOption('duct.max.z');await page.getByLabel('測定できない',{exact:true}).check();await page.getByLabel('Measurement reason').fill('Ceiling access unavailable; height must remain unknown');rev=(await read()).inputRevision;
 await page.getByRole('button',{name:'測定結果を保存',exact:true}).click();await wait(s=>s.inputRevision===rev+1);await page.reload();await open(page,'測定と不足情報');
 let s=await read();check('Unavailable measurement survives reload',s.siteFacts.some(f=>f.field==='duct.max.z'&&f.value===null&&f.unknownReason.includes('Ceiling access')));
 check('Independent confirmed inputs remain',s.siteFacts.some(f=>f.field==='duct.min.x'&&f.value===1200));check('Old results do not become current',!s.outputs.results.some(r=>r.inputRevision===s.inputRevision));
 await page.getByLabel('Measurement field').selectOption('duct.max.z');await page.getByLabel('Measurement value').fill('300');await page.getByLabel('Measurement reason').fill('Synthetic oracle restored after unavailable test');await page.getByLabel('検証用の仮定',{exact:true}).check();await page.getByLabel('入力値と根拠を確認した').check();rev=s.inputRevision;
 await page.getByRole('button',{name:'測定結果を保存',exact:true}).click();await wait(s=>s.inputRevision===rev+1);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,'measurement-mobile.png'),fullPage:true});check('Measurement controls fit mobile',await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await writeFile(join(out,'snapshot.json'),JSON.stringify(await read(),null,2));
}catch(e){report.errors.push(String(e));process.exitCode=1;console.error(e);await page.screenshot({path:join(out,'failure.png'),fullPage:true});}
finally{await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}

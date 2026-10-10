/** Real browser + real Pi/JEV. No seeded package, supplied route, or intercepted AI responses. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const base=process.env.E2E_BASE??'http://127.0.0.1:4329',token=process.env.E2E_TOKEN;
if(!token)throw Error('E2E_TOKEN required');
const out=process.env.E2E_OUT??'e2e-out/site-change';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chromium'}),ctx=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true}),page=await ctx.newPage();
let packageId;const report={checks:[],errors:[],packages:[]};
page.on('pageerror',e=>report.errors.push(String(e)));
const check=(name,value)=>{assert(value,name);report.checks.push(name);console.log('PASS',name);};
const snapshot=async()=>{const r=await ctx.request.get(`${base}/api/work-packages/${packageId}`,{headers:{Authorization:`Bearer ${token}`}});assert(r.ok());return r.json();};
const wait=async(predicate,timeout=180000)=>{const end=Date.now()+timeout;while(Date.now()<end){const s=await snapshot();if(predicate(s))return s;if(['failed','cancelled'].includes(s.run?.status))throw Error(`Pi ${s.run.status}: ${s.run.stopReason}; inspect cumulative budget and events log`);await page.waitForTimeout(800);}throw Error(`Timed out: ${JSON.stringify((await snapshot()).run)}`);};
const openSection=async text=>{const d=page.locator('details').filter({has:page.locator('summary',{hasText:text})}).first();await d.waitFor({state:'visible'});if(await d.getAttribute('open')===null)await d.locator('summary').first().click();};
const saved=async(action)=>{const before=(await snapshot()).inputRevision;await action();await wait(s=>s.inputRevision>before,30000);await page.reload();await page.getByRole('button',{name:'Export',exact:true}).waitFor();};
const exportFiles=async prefix=>{
  const sRevision=(await snapshot()).inputRevision;
  await page.getByRole('button',{name:'Export',exact:true}).click();
  if(!(await snapshot()).outputs.artifacts.some(a=>a.inputRevision===(sRevision)))await page.getByRole('button',{name:/Create export for rev/}).click();
  const s=await wait(s=>s.outputs.artifacts.filter(a=>a.inputRevision===s.inputRevision).length===4,300000);
  const downloads=page.locator('.fa-downloads li');await downloads.first().waitFor();
  for(let i=0;i<await downloads.count();i++){const item=downloads.nth(i),event=page.waitForEvent('download');await item.getByRole('button',{name:'Download',exact:true}).click();const dl=await event;await dl.saveAs(join(out,`${prefix}${dl.suggestedFilename()}`));check(`Browser download ${i+1}`,!(await dl.failure()));}
  await page.getByRole('button',{name:'Close',exact:true}).last().click();
  console.log(execFileSync('python3',['scripts/verify-site-artifacts.py',out,prefix],{encoding:'utf8'}).trim());
};
try{
 await page.goto(base);await page.locator('input[type=password]').fill(token);await page.locator('input[type=password]').press('Enter');
 await page.getByRole('button',{name:'English',exact:true}).click();
 for(let run=1;run<=Number(process.env.E2E_REPEAT??1);run++){
  if(run>1)await page.getByRole('button',{name:'Work packages',exact:true}).first().click();
  let s;
  if(!process.env.E2E_RESUME) {
  const name=`Site E2E ${Date.now()} ${run}`;
  await page.getByLabel('Adapt to site conditions name').fill(name);
  const response=page.waitForResponse(r=>r.url().endsWith('/api/work-packages')&&r.request().method()==='POST');
  await page.locator('form.fa-entry-card').nth(1).locator('button[type=submit]').click();packageId=(await(await response).json()).id;report.packages.push(packageId);
  await page.getByLabel('Add site evidence').setInputFiles('fixtures/site-change/fs01.pdf');
  await wait(s=>s.siteWork?.evidence.length===1,40000);
  await page.getByText('読み取り範囲（0〜1）',{exact:true}).click();
  for(const [k,v]of Object.entries({x:1780/3024,y:1765/2160,width:110/3024,height:130/2160}))await page.getByLabel(`Crop ${k}`,{exact:true}).fill(String(v));
  await page.getByLabel('Reading instruction').fill('Read the central vertical 2-inch pipe from the upper circular head to the lower circular head. Propose exactly one pipe with those two centers as endpoints and the two endpoint heads. Keep positions from the image. No interior neighboring branches. Do not guess lengths or heights. English labels and notes.');
  await page.getByRole('button',{name:'AIで読み取る',exact:true}).click();await wait(s=>!!s.siteWork?.readings.length);
  s=await snapshot();let reading=s.siteWork.readings.at(-1);check('AI returned a pipe from the real drawing',reading.items.some(i=>i.kind==='pipe'&&i.points.length===2));
  await page.screenshot({path:join(out,`${run}-drawing-reading.png`),fullPage:true});
  await page.getByLabel('Confirmed span length').fill('3047.661333333333');await page.getByLabel('Confirmed pipe elevation').fill('0');await page.getByLabel('Hypothetical elevation').check();await page.getByLabel('Reading products').selectOption('steel_nps2');await page.getByLabel('Reading reviewer').fill('E2E drawing reviewer');
  await saved(()=>page.getByRole('button',{name:'選択項目を確認して保存',exact:true}).click());
  s=await snapshot();check('Human confirmation created the baseline',s.baselinePlan?.entities.some(e=>e.kind==='pipe'));check('Steel source selection preserved',s.baselinePlan.entities.find(e=>e.kind==='pipe').productId==='wheatland/a53-sch40-black-nps2');
  await openSection('資料をAIで読み取り・確認');await page.getByLabel('Evidence role').selectOption('site');await page.getByLabel('検証用の架空資料（実測として扱わない）').check();
  await page.getByLabel('Add site evidence').setInputFiles('fixtures/site-change/site-dimensions.png');await wait(s=>s.siteWork.evidence.length===2);
  if(!await page.getByLabel('Crop x',{exact:true}).isVisible())await page.getByText('読み取り範囲（0〜1）',{exact:true}).click();
  for(const[k,v]of Object.entries({x:0,y:0,width:1,height:1}))await page.getByLabel(`Crop ${k}`,{exact:true}).fill(String(v));
  await page.getByLabel('Reading instruction').fill('Read every explicitly written coordinate/dimension and its field name. One dimension item for EACH field, including both min and max on each line. All 15 values including clearance and envelope radii. Diagram not to scale. Do not propose another baseline. English notes.');
  await page.getByRole('button',{name:'AIで読み取る',exact:true}).click();await wait(s=>s.siteWork.readings.length===2);
  s=await snapshot();reading=s.siteWork.readings.at(-1);check('AI read the site coordinates',reading.items.some(i=>i.field==='duct.min.x'&&i.value===1200));
  await page.getByLabel('Reading reviewer').fill('E2E synthetic source reviewer');await saved(()=>page.getByRole('button',{name:'選択項目を確認して保存',exact:true}).click());
  s=await snapshot();check('Synthetic evidence stays proposed',s.siteFacts.filter(f=>f.field.startsWith('duct.')).every(f=>f.provenance==='synthetic_assumption'&&f.confirmation==='proposed'));
  } else { packageId=process.env.E2E_RESUME;const all=await(await ctx.request.get(`${base}/api/work-packages`,{headers:{Authorization:`Bearer ${token}`}})).json();await page.getByText(all.find(p=>p.id===packageId).title,{exact:true}).click(); }
  await page.reload();await openSection('測定と不足情報');
  if(!process.env.E2E_RESUME){await page.getByLabel('Measurement field').selectOption('duct.max.z');await page.getByRole('img',{name:'資料上の測定箇所',exact:true}).waitFor();check('Measurement guide uses reviewed source location',await page.getByTestId('measurement-guide').locator('circle').count()>0);await page.screenshot({path:join(out,`${run}-measurement-guide.png`),fullPage:true});}
  if(process.env.E2E_STAGE!=='export') {
  await page.getByRole('button',{name:'保存した情報でPiを再開',exact:true}).click();
  s=await wait(s=>['waiting_input','completed','blocked'].includes(s.run?.status)&&!!s.outputs.candidates,300000);
  check('Real Pi produced two bounded routes',s.outputs.candidates.candidates.length===2);
  const lengths=s.outputs.candidates.candidates.map(c=>c.metrics.find(m=>m.name==='centerline_delta').quantity.value);check('Independent centerline oracle',Math.abs(lengths[0]-1.55)<1e-8&&Math.abs(lengths[1]-1.75)<1e-8);check('Four elbows per route',s.outputs.candidates.candidates.every(c=>c.plan.entities.filter(e=>e.kind==='fitting').length===4));
  console.log('Candidate metrics',JSON.stringify(s.outputs.candidates.candidates.map(c=>c.metrics)));
  check('Comparison draws pipe geometry',await page.locator('svg[aria-label="Plan view of the run"] .fa-pipe').count()>=5);
  await page.screenshot({path:join(out,`${run}-candidates.png`),fullPage:true});
  const select=page.getByRole('button',{name:/Select & build Route/}).first();await select.click();
  s=await wait(s=>!!s.selectedPlan&&s.outputs.results.some(r=>r.planId===s.selectedPlan.id&&r.inputRevision===s.inputRevision)&&['waiting_input','completed','blocked'].includes(s.run?.status),300000);
  check('User selected a route',!!s.selectedPlan);
  await page.screenshot({path:join(out,`${run}-selected.png`),fullPage:true});
  await writeFile(join(out,`${run}-snapshot.json`),JSON.stringify(s,null,2));
  }
  s=await snapshot();
  check('Envelope arithmetic ran',s.outputs.results.find(r=>r.planId===s.selectedPlan.id&&r.inputRevision===s.inputRevision).evaluations.some(e=>e.reason.includes('EnvelopeRadius:')&&e.status==='pass'));
  await exportFiles(`${run}-`);
  await openSection('設計者の回答・再確認');await page.getByLabel('Designer name').fill('E2E reviewer');await page.getByLabel('Designer decision').selectOption('conditional');await page.getByLabel('Designer conditions').fill('TEST REVIEW: revise fitting envelope from 100 to 900 mm; supports, head coverage and hydraulics remain pending practitioner review.');
  await saved(()=>page.getByRole('button',{name:'回答を記録',exact:true}).click());
  s=await snapshot();check('Response bound to selected plan',s.siteWork.reviews.at(-1).planId===s.selectedPlan.id);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(out,`${run}-mobile-review.png`),fullPage:true});
  check('Mobile viewport fits',await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  await page.setViewportSize({width:1440,height:1000});
  await openSection('測定と不足情報');await page.getByLabel('Measurement field').selectOption('fittingEnvelopeRadius');await page.getByLabel('Measurement value').fill('900');await page.getByLabel('Measurement reason').fill('Synthetic negative envelope case, independent 900 mm oracle');await page.getByLabel('検証用の仮定',{exact:true}).check();await page.getByLabel('入力値と根拠を確認した').check();
  await saved(()=>page.getByRole('button',{name:'測定結果を保存',exact:true}).click());
  await page.reload();await openSection('設計者の回答・再確認');check('Old response is visibly stale',await page.getByText('案が変更されています：再確認が必要',{exact:false}).isVisible());
  await openSection('測定と不足情報');await page.getByRole('button',{name:'保存した情報でPiを再開',exact:true}).click();
  s=await wait(s=>s.outputs.results.some(r=>r.planId===s.selectedPlan?.id&&r.inputRevision===s.inputRevision)&&['waiting_input','completed','blocked'].includes(s.run?.status),300000);
  check('Oversized fitting envelope fails',s.outputs.results.find(r=>r.planId===s.selectedPlan.id&&r.inputRevision===s.inputRevision).evaluations.some(e=>e.reason.includes('EnvelopeRadius:')&&e.status==='fail'));
  await exportFiles(`${run}-revised-`);
  await writeFile(join(out,`${run}-final-snapshot.json`),JSON.stringify(await snapshot(),null,2));
  console.log(execFileSync('python3',['scripts/verify-reading-oracles.py',join(out,`${run}-final-snapshot.json`)],{encoding:'utf8'}).trim());
 }
 check('No browser runtime errors',report.errors.length===0);
}catch(e){report.errors.push(String(e));await page.screenshot({path:join(out,'failure.png'),fullPage:true});console.error(String(e));console.error((await page.locator('body').innerText()).slice(-6500));process.exitCode=1;}
finally{await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));await browser.close();}

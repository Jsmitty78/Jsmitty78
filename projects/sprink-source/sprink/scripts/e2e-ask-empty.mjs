/** Offline browser regression: an empty source library must not invent an answer. */
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.E2E_BASE??'http://127.0.0.1:4329',token=process.env.E2E_TOKEN,out='e2e-out/ask-empty';if(!token)throw Error('E2E_TOKEN required');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chromium'}),page=await browser.newPage(),report={checks:[],errors:[]};
try{
 await page.goto(base);await page.locator('input[type=password]').fill(token);await page.locator('input[type=password]').press('Enter');await page.getByRole('button',{name:'English',exact:true}).click();
 await page.getByLabel('Project',{exact:true}).fill(`empty-${Date.now()}`);await page.getByLabel('Adapt to site conditions name').fill('Empty-library Ask regression');await page.locator('form.fa-entry-card').nth(1).locator('button[type=submit]').click();await page.getByRole('button',{name:'Codes',exact:true}).click();
 await page.getByLabel('Question',{exact:true}).fill('Does this duct comply with the sprinkler requirements?');const pending=page.waitForResponse(r=>r.url().endsWith('/api/ask')&&r.request().method()==='POST');await page.getByRole('button',{name:'Ask question',exact:true}).click();const response=await pending;assert(response.ok());const answer=await response.json();assert.equal(answer.status,'no_source');assert.equal(answer.sources.length,0);report.checks.push('Empty-library Ask returns no_source without invented citations');await writeFile(`${out}/answer.json`,JSON.stringify(answer,null,2));await page.screenshot({path:`${out}/ask.png`,fullPage:true});console.log('PASS empty-library Ask');
}catch(e){report.errors.push(String(e));process.exitCode=1;console.error(e);}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();}

import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
const base=process.env.TEST_URL || 'http://127.0.0.1:4319';
const browser=await chromium.launch({channel:'chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const state=async()=>await(await page.request.get(base+'/api/state')).json();
async function saveSelection(label:string,value:string){
 const response=page.waitForResponse(r=>r.url().endsWith('/generation')&&r.request().method()==='POST');
 await page.getByLabel(label,{exact:true}).selectOption(value);
 const result=await response;assert.equal(result.status(),200,await result.text());return await result.json();
}
try{
 await page.goto(base);
 await page.getByRole('button',{name:'Add book',exact:true}).click();
 await page.getByLabel('Book name').fill('Model selection verification');
 await page.getByLabel('Material directory').fill(resolve('examples/materials'));
 const created=page.waitForResponse(r=>r.url()===base+'/api/books'&&r.request().method()==='POST');
 await page.getByRole('dialog').getByRole('button',{name:'Add book'}).click();const book=await(await created).json();
 await page.getByLabel('Model',{exact:true}).selectOption('fixture-alpha');
 await page.getByLabel('Reasoning effort').selectOption('high');
 await page.getByLabel('New learning prompt').fill('first proof');
 await page.getByRole('button',{name:'Start learning'}).click();
 await page.getByRole('button',{name:'Reading S1'}).click();
 await page.getByRole('heading',{name:'Verified fixture-alpha/high'}).waitFor();
 const before=(await state()).books[book.id];
 const after=await saveSelection('Model','fixture-beta');assert.equal(after.threadId,before.threadId);
 assert.deepEqual(after.trees,before.trees);assert.deepEqual(after.nodes,before.nodes);
 assert.deepEqual(await page.getByLabel('Reasoning effort').locator('option').evaluateAll(options=>options.map(o=>(o as HTMLOptionElement).value)),['','medium']);
 await saveSelection('Reasoning effort','medium');
 await page.reload();await page.getByRole('button',{name:'Reading S1'}).waitFor();
 assert.equal(await page.getByLabel('Model',{exact:true}).inputValue(),'fixture-beta');
 assert.equal(await page.getByLabel('Reasoning effort').inputValue(),'medium');
 await page.getByLabel('New learning prompt').fill('second proof');
 await page.getByRole('button',{name:'Start learning'}).click();
 await page.getByRole('button',{name:'Reading S1'}).click();
 await page.getByRole('heading',{name:'Verified fixture-beta/medium'}).waitFor();
 assert.equal((await state()).books[book.id].threadId,before.threadId);
 mkdirSync('.data/screenshots',{recursive:true});await page.screenshot({path:'.data/screenshots/model-controls.png',fullPage:true});
 const reset=await saveSelection('Model','');assert.deepEqual(reset.generation,{model:null,effort:null});
 await page.getByRole('button',{name:'Clear map',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Clear map',exact:true}).click();
 assert.deepEqual(errors,[]);
 console.log('Model/effort selection, capability filtering, next-turn application, persistence and thread preservation passed in Chrome.');
}finally{await browser.close();}

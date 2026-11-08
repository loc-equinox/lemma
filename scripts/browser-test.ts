import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
const base = process.env.TEST_URL || 'http://127.0.0.1:4317';
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {channel:'chrome'}) });
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const state=async()=>await (await page.request.get(base+'/api/state')).json();
async function waitFor(predicate: (s:any)=>boolean) {
  const start=Date.now();while(!predicate(await state())){if(Date.now()-start>20000)throw new Error('Browser state assertion timed out');await page.waitForTimeout(100);}
}
try {
 await page.goto(base);
 await page.getByRole('button',{name:'Add a book',exact:true}).click();
 await page.getByLabel('Book name').fill('Browser verification');
 await page.getByLabel('Material directory').fill(resolve('examples/materials'));
 await page.getByRole('button',{name:'Add book',exact:true}).click();
 await page.getByLabel('New learning prompt').fill('Prove that 1/n converges to zero');
 await page.getByRole('button',{name:'Start learning'}).click();
 let bookId='';
 await waitFor(s=>{const b:any=Object.values(s.books).find((b:any)=>b.name==='Browser verification');bookId=b?.id;return b&&Object.keys(b.nodes).length===2;});
 await page.getByRole('button',{name:'Reading S1'}).click();
 await page.locator('.reader .katex').first().waitFor();
 let b=(await state()).books[bookId];const first=b.routes[Object.values<any>(b.trees)[0].routeId].nodeIds[0];
 await page.getByRole('button',{name:'Continue to S2'}).click();
 await waitFor(s=>Object.keys(s.books[bookId].nodes).length===3);
 b=(await state()).books[bookId];const cursorBefore=JSON.stringify(Object.values<any>(b.trees)[0].cursor);
 await page.getByRole('button',{name:'Close reader'}).click();
 await page.locator(`[data-id="${first}"]`).click();
 assert.equal(JSON.stringify(Object.values<any>((await state()).books[bookId].trees)[0].cursor),cursorBefore);
 await page.getByLabel('Something unclear?').fill('Why must the whole tail lie within epsilon?');
 await page.getByRole('button',{name:'Comment',exact:false}).click();
 await page.getByRole('button',{name:'Enter explanation'}).click();
 await waitFor(s=>Object.keys(s.books[bookId].nodes).length===5);
 await page.getByRole('button',{name:/Continue to S1\.1b/}).click();
 await page.getByRole('button',{name:'Return to S2'}).click();
 await page.getByRole('button',{name:'Continue to S3'}).waitFor();
 assert.equal(JSON.stringify(Object.values<any>((await state()).books[bookId].trees)[0].cursor),cursorBefore);
 await page.reload();
 await page.getByRole('button',{name:'Reading S2'}).click();
 await page.locator('.reader .katex').first().waitFor();
 mkdirSync('.data/screenshots',{recursive:true});await page.screenshot({path:'.data/screenshots/desktop.png',fullPage:true});
 await page.setViewportSize({width:780,height:900});await page.screenshot({path:'.data/screenshots/narrow.png',fullPage:true});
 await page.getByRole('button',{name:'Clear map',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Clear map',exact:true}).click();
 await waitFor(s=>Object.keys(s.books[bookId].nodes).length===0);
 assert.ok((await state()).books[bookId].threadId);
 assert.deepEqual(errors,[]);
 console.log('Browser workflows, LaTeX, persisted progress, branch return, responsive layouts and Clear passed.');
} finally {await browser.close();}

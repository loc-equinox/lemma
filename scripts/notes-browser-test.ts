import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const base=process.env.TEST_URL||'http://127.0.0.1:4320';
const material=mkdtempSync(join(tmpdir(),'lemma-notes-browser-'));
writeFileSync(join(material,'STUDY_NOTES.md'),'# Existing notes\n\nPreserve my earlier CLI notes.\n');
const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
const state=async()=>await(await page.request.get(base+'/api/state')).json();
async function waitFor(check:(s:any)=>boolean){for(let i=0;i<100;i++){if(check(await state()))return;await page.waitForTimeout(100);}throw new Error('State assertion timed out');}
try{
 await page.goto(base);await page.getByRole('button',{name:'Add book',exact:true}).click();await page.getByLabel('Book name').fill('Chapter references');await page.getByLabel('Material directory').fill(material);
 const added=page.waitForResponse(r=>r.url()===base+'/api/books'&&r.request().method()==='POST');await page.getByRole('dialog').getByRole('button',{name:'Add book'}).click();const bookId=(await(await added).json()).id;
 await page.getByLabel('Task type').selectOption('notes');await page.getByLabel('Chapter or topic').fill('Chapter 1 — Limits');await page.getByLabel('New learning prompt').fill('Summarize the important conclusions of this chapter.');await page.getByRole('button',{name:'Save chapter notes'}).click();
 await waitFor(s=>Object.values<any>(s.books[bookId].jobs).some(j=>j.kind==='notes'&&j.status==='completed'));
 let b=(await state()).books[bookId];assert.equal(Object.keys(b.trees).length,0);assert.equal(b.activeTreeId,null);assert.match(readFileSync(join(material,'STUDY_NOTES.md'),'utf8'),/Preserve my earlier CLI notes/);
 const ref:any=Object.values(b.references)[0];await page.getByRole('navigation',{name:'Saved references'}).getByRole('button',{name:/Chapter 1/}).click();
 const reader=page.getByRole('complementary',{name:'Reference reader'});await reader.getByRole('heading',{name:'Chapter 1 — Limits'}).waitFor();assert.equal(await reader.getByRole('button',{name:/Continue|Complete this task/}).count(),0);
 await reader.getByRole('button',{name:'Markdown source'}).click();assert.equal(await reader.getByRole('textbox',{name:'Markdown source'}).inputValue(),ref.content);await reader.getByRole('button',{name:'Rendered',exact:true}).click();
 await reader.getByLabel('Ask about this reference').fill('Explain the quantifiers.');await reader.getByRole('button',{name:'Comment'}).click();await reader.getByRole('button',{name:'Enter explanation'}).click();
 await waitFor(s=>Object.keys(s.books[bookId].nodes).length===2);await page.getByRole('button',{name:/Continue to Reference/}).click();await page.getByRole('button',{name:'Complete this task'}).click();
 b=(await state()).books[bookId];assert.equal(b.trees[b.activeTreeId].cursor,null);
 await page.getByLabel('Task type').selectOption('learn');await page.getByLabel('New learning prompt').fill('Explain convergence');await page.getByRole('button',{name:'Start learning'}).click();await waitFor(s=>Object.keys(s.books[bookId].nodes).length===4);
 b=(await state()).books[bookId];const cursor=JSON.stringify(b.trees[b.activeTreeId].cursor);
 await page.getByLabel('New learning prompt').fill('请更新学习进度');await page.getByRole('button',{name:/^Update progress/}).click();await waitFor(s=>Object.values<any>(s.books[bookId].jobs).some(j=>j.kind==='progress'&&j.status==='completed'));
 assert.match(readFileSync(join(material,'STUDY_PROGRESS.md'),'utf8'),/Study progress/);b=(await state()).books[bookId];assert.equal(JSON.stringify(b.trees[b.activeTreeId].cursor),cursor);
 await page.getByRole('navigation',{name:'Saved references'}).getByRole('button',{name:/Chapter 1/}).click();mkdirSync('.data/screenshots',{recursive:true});await page.screenshot({path:'.data/screenshots/chapter-reference.png'});
 await page.getByRole('button',{name:'Close reader'}).click();await page.screenshot({path:'.data/screenshots/reference-map.png'});
 await page.getByRole('button',{name:'Clear map',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Clear map',exact:true}).click();await waitFor(s=>Object.keys(s.books[bookId].references).length===0);
 await page.getByRole('button',{name:'Open saved notes',exact:true}).click();await waitFor(s=>Object.keys(s.books[bookId].references).length>0);assert.equal(Object.keys((await state()).books[bookId].trees).length,0);
 await page.reload();await page.getByRole('navigation',{name:'Saved references'}).getByRole('button',{name:/Chapter 1/}).waitFor();assert.deepEqual(errors,[]);
 console.log('Chapter notes, progress commands, reference questions, unchanged cursor, Clear/reopen and refresh passed.');
}catch(e){mkdirSync('.data/screenshots',{recursive:true});await page.screenshot({path:'.data/screenshots/notes-failure.png'});console.error(errors);throw e;}finally{await browser.close();}

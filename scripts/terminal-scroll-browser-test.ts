import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { Book } from '../src/shared/types';
import type { TerminalEvent } from '../src/shared/terminal';

// Mock only data/SSE: real production DOM, CSS and native wheel scrolling.
// This test can run against the local app without changing any user's workspace.
const base=process.env.TEST_URL||'http://127.0.0.1:4317';
const book:Book={id:'scroll-fixture',name:'Terminal scrolling',directory:'/fixture',threadId:null,epoch:0,activeTreeId:null,generation:{model:null,effort:null},references:{},trees:{},routes:{},nodes:{},questions:{},jobs:{},actions:{}};
const entries:TerminalEvent[]=[
  {seq:1,jobId:'scroll-job',time:new Date().toISOString(),kind:'prompt',text:'Explain the definition.'},
  {seq:2,jobId:'scroll-job',time:new Date().toISOString(),kind:'command',itemId:'read',text:'$ cat textbook.txt'},
  {seq:3,jobId:'scroll-job',time:new Date().toISOString(),kind:'output',itemId:'read',text:Array.from({length:85},(_,i)=>`Textbook line ${i+1}: a substitution maps variables to terms. 数学公式 x = x.`).join('\n')},
  {seq:4,jobId:'scroll-job',time:new Date().toISOString(),kind:'message',itemId:'answer',text:'The explanation is complete.'},
  {seq:5,jobId:'scroll-job',time:new Date().toISOString(),kind:'status',text:'completed'},
];
const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
const output=page.getByRole('log',{name:'Codex terminal output'});
const toggle=page.getByRole('button',{name:'Terminal',exact:true});
const metrics=()=>output.evaluate(el=>({top:el.scrollTop,max:el.scrollHeight-el.clientHeight}));
async function wheel(delta:number) {
  const before=await metrics();await page.mouse.wheel(0,delta);await page.waitForTimeout(80);const after=await metrics();
  if(delta<0&&before.top>2)assert.ok(after.top<before.top-1,`Upward wheel stuck at ${after.top}/${after.max}`);
  if(delta>0&&before.top<before.max-2)assert.ok(after.top>before.top+1,`Downward wheel stuck at ${after.top}/${after.max}`);
}
async function sweep() {
  const bounds=(await output.boundingBox())!;await page.mouse.move(bounds.x+bounds.width*.6,bounds.y+bounds.height*.5);
  // Continue wheeling while a long tool-output block moves underneath the pointer.
  for(let i=0;i<60&&(await metrics()).top>2;i++)await wheel(-180);
  assert.ok((await metrics()).top<2,'Must be able to reach the beginning');
  await wheel(280);await wheel(280);await wheel(-140);await wheel(160);
  for(let i=0;i<60&&(await metrics()).top<(await metrics()).max-2;i++)await wheel(180);
  const end=await metrics();assert.ok(end.max-end.top<2,'Must be able to return to the end');
}
try {
  await page.route('**/api/state',route=>route.fulfill({json:{schemaVersion:1,provider:'demo',books:{[book.id]:book}}}));
  await page.route('**/api/events',route=>route.fulfill({contentType:'text/event-stream',body:'data: changed\n\n'}));
  await page.route('**/api/books/*/terminal',route=>route.fulfill({contentType:'text/event-stream',body:`event: terminal\ndata: ${JSON.stringify({reset:true,events:entries,truncated:false})}\n\n`}));
  await page.goto(base);await toggle.click();await output.getByText('The explanation is complete.',{exact:true}).waitFor();await page.waitForTimeout(150);
  await sweep();
  await page.getByRole('button',{name:'Close terminal'}).click();await toggle.click();await output.getByText('The explanation is complete.',{exact:true}).waitFor();await page.waitForTimeout(150);
  await sweep();
  await page.setViewportSize({width:780,height:900});await page.waitForTimeout(150);await sweep();
  assert.deepEqual(errors,[]);
  console.log('Native wheel scrolling passed: full tool output in both directions, direction reversal, close/reopen and narrow layout.');
}catch(error){mkdirSync('.data/screenshots',{recursive:true});await page.screenshot({path:'.data/screenshots/terminal-scroll-failure.png'});throw error;}finally{await browser.close();}

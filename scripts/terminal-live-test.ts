import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexProvider } from '../src/server/codex';
import { Engine } from '../src/server/engine';
import { Store } from '../src/server/store';
const root=mkdtempSync(resolve('.data/terminal-live-'));
const store=new Store(join(root,'workspace.sqlite')),engine=new Engine(store,new CodexProvider(join(root,'context')));
try {
  const book=engine.addBook('Live terminal',resolve('examples/materials'));
  await engine.configure(book.id,{model:'gpt-6.1-sol',effort:'low'});
  engine.newTree(book.id,'Read convergence.md and state its definition of convergence in exactly one conceptual step. Finish after that step.',randomUUID());
  let observedWhileRunning=false;const began=Date.now();
  while(engine.running.has(book.id)) {
    if(Date.now()-began>360000)throw new Error('Live generation timed out');
    if(engine.terminal.read(book.id).events.some(e=>['message','command','output'].includes(e.kind)))observedWhileRunning=true;
    await new Promise(r=>setTimeout(r,100));
  }
  const job=Object.values(book.jobs)[0],events=engine.terminal.read(book.id).events;
  writeFileSync(join(root,'result.json'),JSON.stringify({job,events,observedWhileRunning},null,2));
  assert.equal(job.status,'completed',job.error);assert.ok(job.startedAt&&job.endedAt);assert.ok(observedWhileRunning);
  assert.ok(events.some(e=>e.kind==='prompt'&&JSON.parse(e.text).jobId===job.id));
  assert.ok(events.some(e=>e.kind==='message'&&e.replace));assert.equal(Object.keys(book.nodes).length,1);
  console.log(`Real Codex terminal stream and generation passed. Evidence: ${root}/result.json`);
}finally{engine.close();store.close();}

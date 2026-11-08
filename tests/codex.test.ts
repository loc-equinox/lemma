import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { CodexProvider } from '../src/server/codex';
import { Engine } from '../src/server/engine';
import { Store } from '../src/server/store';
import { randomUUID } from 'node:crypto';
async function settle(e:Engine,bookId:string) {
 const start=Date.now();while(e.running.has(bookId)){if(Date.now()-start>10000)throw new Error('Timeout');await new Promise(r=>setTimeout(r,10));}
}
test('real subprocess transport handles JSON-RPC, structured output, streaming, interruption and resume',async()=>{
 const original=process.env.CODEX_BIN;process.env.CODEX_BIN=resolve('tests/fixtures/fake-codex.mjs');
 const store=new Store(join(mkdtempSync(join(tmpdir(),'lemma-rpc-')),'state.sqlite'));
 let provider=new CodexProvider(),engine=new Engine(store,provider);
 try{
  const b=engine.addBook('RPC fixture',process.cwd());engine.newTree(b.id,'normal',randomUUID());await settle(engine,b.id);
  assert.equal(Object.keys(b.nodes).length,2);assert.equal(b.threadId,'fixture-thread');assert.equal(Object.values(b.jobs)[0].status,'completed');
  engine.clear(b.id);engine.close();provider=new CodexProvider();engine=new Engine(store,provider);
  engine.newTree(b.id,'slow',randomUUID());await new Promise(r=>setTimeout(r,100));engine.clear(b.id);await settle(engine,b.id);assert.equal(Object.keys(b.nodes).length,0);assert.equal(b.threadId,'fixture-thread');
  engine.newTree(b.id,'resumed',randomUUID());await settle(engine,b.id);assert.equal(Object.keys(b.nodes).length,2);assert.ok(Object.values(b.jobs).every(j=>j.status==='completed'));
 }finally{engine.close();store.close();if(original)process.env.CODEX_BIN=original;else delete process.env.CODEX_BIN;}
});

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
test('model catalog pagination, supported efforts, next-turn settings and persistence keep the same thread',async()=>{
 const original=process.env.CODEX_BIN;process.env.CODEX_BIN=resolve('tests/fixtures/fake-codex.mjs');
 const path=join(mkdtempSync(join(tmpdir(),'lemma-models-')),'state.sqlite');
 let store=new Store(path),provider=new CodexProvider(),engine=new Engine(store,provider);
 try{
  let b=engine.addBook('Model settings',process.cwd());const bookId=b.id;
  const catalog=await engine.models(bookId);
  assert.equal(catalog.models.length,2);assert.equal(catalog.defaultModel,'fixture-alpha');assert.equal(catalog.defaultEffort,'high');
  engine.newTree(bookId,'slow',randomUUID());
  await engine.configure(bookId,{model:'fixture-beta',effort:'medium'});
  await settle(engine,bookId);
  assert.equal(Object.values(b.nodes)[0].title,'Verified fixture-alpha/high');
  const thread=b.threadId;
  await assert.rejects(engine.configure(bookId,{model:'fixture-beta',effort:'high'}),/does not support/);
  await assert.rejects(engine.configure(bookId,{model:'unknown',effort:null}),/not in/);
  engine.newTree(bookId,'new settings',randomUUID());await settle(engine,bookId);
  assert.equal(Object.values(b.nodes).at(-1)!.title,'Verified fixture-beta/medium');assert.equal(b.threadId,thread);
  engine.clear(bookId);assert.deepEqual(b.generation,{model:'fixture-beta',effort:'medium'});
  engine.close();store.close();store=new Store(path);provider=new CodexProvider();engine=new Engine(store,provider);b=engine.book(bookId);
  engine.newTree(bookId,'resume with settings',randomUUID());await settle(engine,bookId);
  assert.equal(Object.values(b.nodes)[0].title,'Verified fixture-beta/medium');assert.equal(b.threadId,thread);
  await engine.configure(bookId,{model:null,effort:null});engine.newTree(bookId,'restore defaults',randomUUID());await settle(engine,bookId);
  assert.equal(Object.values(b.nodes).at(-1)!.title,'Verified fixture-alpha/high');assert.equal(b.threadId,thread);
  const other=engine.addBook('Independent book',process.cwd());assert.deepEqual(other.generation,{model:null,effort:null});
 }finally{engine.close();store.close();if(original)process.env.CODEX_BIN=original;else delete process.env.CODEX_BIN;}
});

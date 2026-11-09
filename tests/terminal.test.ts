import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TerminalLog } from '../src/server/terminal';
import { terminalBlocks, terminalMaxChars, terminalMaxEvents, workingTime } from '../src/shared/terminal';
import { observeCodex } from '../src/server/codex-terminal';
import { CodexProvider } from '../src/server/codex';
import { Store } from '../src/server/store';
import { Engine, type Provider } from '../src/server/engine';

const pause = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(check: () => boolean) { for (let i=0; i<1000; i++) { if (check()) return; await pause(); } throw new Error('Timed out'); }

test('terminal retains bounded ordered replay, isolates books and resets on Clear', () => {
  const log = new TerminalLog();
  for (let i=0;i<2200;i++) log.write('a','job',{kind:'message',itemId:'answer',text:'x'.repeat(400)});
  assert.ok(log.read('a').truncated);
  assert.ok(log.read('a').events.length <= terminalMaxEvents);
  assert.ok(log.read('a').events.reduce((n,e)=>n+e.text.length,0) <= terminalMaxChars);
  assert.equal(log.read('b').events.length,0);
  log.write('a','job',{kind:'message',itemId:'answer',text:'final authoritative answer',replace:true});
  assert.equal(terminalBlocks(log.read('a').events)[0].text,'final authoritative answer');
  const version=log.read('a').version;log.clear('a');assert.equal(log.read('a').events.length,0);assert.ok(log.read('a').version>version);
  log.write('a','job',{kind:'output',text:'z'.repeat(terminalMaxChars+1)});
  assert.equal(log.read('a').events[0].text.length,terminalMaxChars);assert.ok(log.read('a').truncated);
});

test('terminal maps public stream and final output without raw reasoning or duplicate final text', () => {
  const log=new TerminalLog(),emit=(event:any)=>log.write('book','job',event);
  observeCodex('item/agentMessage/delta',{itemId:'a',delta:'Partial'},emit);
  observeCodex('item/completed',{item:{type:'agentMessage',id:'a',text:'Completed answer'}},emit);
  observeCodex('item/reasoning/textDelta',{itemId:'r',delta:'raw private reasoning'},emit);
  observeCodex('item/reasoning/summaryTextDelta',{itemId:'r',summaryIndex:0,delta:'Checking assumptions'},emit);
  observeCodex('item/completed',{item:{type:'reasoning',id:'r',summary:['Checked assumptions'],content:['raw private reasoning']}},emit);
  assert.deepEqual(terminalBlocks(log.read('book').events).map(e=>e.text),['Completed answer','Checked assumptions']);
  assert.equal(workingTime('2026-01-01T00:00:00Z',Date.parse('2026-01-01T00:01:24Z')),'1m 24s');
});

test('real transport logs exact sent prompt and live output before completion without workspace churn', async () => {
  const previous=process.env.CODEX_BIN,previousLog=process.env.FAKE_CODEX_LOG;
  const root=mkdtempSync(join(tmpdir(),'lemma-terminal-')),path=join(root,'workspace.sqlite');
  process.env.CODEX_BIN=resolve('tests/fixtures/fake-codex.mjs');process.env.FAKE_CODEX_LOG=join(root,'wire.jsonl');
  const store=new Store(path),engine=new Engine(store,new CodexProvider());
  try {
    const book=engine.addBook('Terminal',process.cwd());let changes=0;engine.on('change',()=>changes++);
    engine.newTree(book.id,'slow observation test',randomUUID());
    const job=Object.values(book.jobs)[0];
    await until(()=>engine.terminal.read(book.id).events.some(e=>e.kind==='message'));
    assert.equal(job.status,'running');assert.ok(job.startedAt);assert.equal(job.endedAt,undefined);
    const entries=()=>engine.terminal.read(book.id).events;
    const wire=readFileSync(process.env.FAKE_CODEX_LOG!,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    assert.equal(entries().find(e=>e.kind==='prompt')!.text,wire.find(e=>e.method==='turn/start').params.input[0].text);
    assert.equal(entries().find(e=>e.kind==='instructions')!.text,wire.find(e=>e.method==='thread/start').params.developerInstructions);
    assert.ok(entries().some(e=>e.kind==='command'));assert.ok(entries().some(e=>e.kind==='output'));
    assert.equal(entries().some(e=>e.text.includes('WRONG')),false);
    await until(()=>!engine.running.has(book.id));
    assert.equal(job.status,'completed');assert.ok(job.endedAt);assert.ok(changes<10,`${changes} workspace notifications`);
    assert.equal(Object.keys(book.nodes).length,2);
    assert.ok(entries().some(e=>e.kind==='status'&&e.text==='completed'));
    engine.newTree(book.id,'Warm connection',randomUUID());await until(()=>!engine.running.has(book.id));
    assert.equal(entries().filter(e=>e.kind==='instructions').length,1,'Warm turns must not log instructions as if they were sent again');
    engine.provider.close?.();
    engine.newTree(book.id,'Resumed connection',randomUUID());await until(()=>!engine.running.has(book.id));
    const requests=readFileSync(process.env.FAKE_CODEX_LOG!,'utf8').trim().split('\n').map(line=>JSON.parse(line));
    const connections=requests.filter(e=>['thread/start','thread/resume'].includes(e.method));
    assert.deepEqual(connections.map(e=>e.method),['thread/start','thread/resume']);
    assert.equal(entries().filter(e=>e.kind==='instructions').length,connections.length);
    assert.ok(requests.filter(e=>e.method==='turn/start').every(e=>!('developerInstructions' in e.params)));
    engine.close();store.close();
    const recovered=new Store(path);assert.equal(recovered.state.books[book.id].jobs[job.id].endedAt,job.endedAt);recovered.close();
  } finally {
    if(!engine.stopped){engine.close();store.close();}
    if(previous)process.env.CODEX_BIN=previous;else delete process.env.CODEX_BIN;
    if(previousLog)process.env.FAKE_CODEX_LOG=previousLog;else delete process.env.FAKE_CODEX_LOG;
  }
});

test('late terminal output after cancellation cannot repopulate a cleared book', async () => {
  let observer: (chunk:any)=>void=()=>{},reject: (error:Error)=>void=()=>{};
  const provider:Provider={generate(_ctx,_signal,_progress,_thread,_metrics,observe){observer=observe!;return new Promise((_resolve,fail)=>{reject=fail;});}};
  const store=new Store(join(mkdtempSync(join(tmpdir(),'lemma-terminal-clear-')),'workspace.sqlite')),engine=new Engine(store,provider);
  try {
    const book=engine.addBook('Clear',process.cwd());engine.newTree(book.id,'Explain',randomUUID());
    observer({kind:'message',text:'before'});assert.ok(engine.terminal.read(book.id).events.length);
    engine.clear(book.id);observer({kind:'message',text:'late'});reject(new Error('Interrupted'));
    await until(()=>!engine.running.has(book.id));assert.deepEqual(engine.terminal.read(book.id).events,[]);
    assert.equal(Object.keys(book.nodes).length,0);
  } finally {engine.close();store.close();}
});

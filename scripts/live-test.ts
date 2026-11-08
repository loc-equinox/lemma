import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { CodexProvider } from '../src/server/codex';
import { Engine } from '../src/server/engine';
import { Store } from '../src/server/store';
import { currentTree, nodeAt } from '../src/shared/types';
import { randomUUID } from 'node:crypto';
const directory = resolve('examples/materials');
const root = mkdtempSync(resolve('.data/live-'));
const store = new Store(join(root,'workspace.sqlite'));
let provider = new CodexProvider();
let engine = new Engine(store,provider);
let book = engine.addBook('Live integration verification',directory);
const pause = () => new Promise(r=>setTimeout(r,250));
async function settle() {
  const start = Date.now();
  while (Object.values(book.jobs).some(j=>['running','queued'].includes(j.status))) {
    if (Date.now()-start>360000) throw new Error('Live generation timed out');
    await pause();
  }
  const failure=Object.values(book.jobs).find(j=>j.status==='failed');
  if (failure) throw new Error(failure.error);
}
try {
  engine.newTree(book.id,'Read convergence.md. Teach its proof in exactly three conceptual steps. Generate the initial two now, leaving the final verification for the third step.',randomUUID());
  await settle();
  assert.equal(Object.keys(book.nodes).length,2);
  assert.ok(book.threadId); const threadId=book.threadId;
  const first=nodeAt(book,currentTree(book)!.cursor)!;
  engine.continue(book.id,first.id,currentTree(book)!.cursorEpoch,randomUUID());
  await settle(); assert.equal(Object.keys(book.nodes).length,3);
  engine.comment(book.id,first.id,'Why is the threshold allowed to depend on epsilon? Answer in one conceptual step.',randomUUID());
  await settle();
  const q=Object.values(book.questions)[0], before=nodeAt(book,currentTree(book)!.cursor)!.id;
  engine.enter(book.id,q.id,randomUUID());
  const explanation=nodeAt(book,currentTree(book)!.cursor)!;
  engine.continue(book.id,explanation.id,currentTree(book)!.cursorEpoch,randomUUID());
  assert.equal(nodeAt(book,currentTree(book)!.cursor)!.id,before);
  engine.clear(book.id);assert.equal(book.threadId,threadId);
  engine.close();store.close();
  const resumedStore=new Store(join(root,'workspace.sqlite'));
  provider=new CodexProvider();engine=new Engine(resumedStore,provider);book=engine.book(book.id);
  engine.newTree(book.id,'Read convergence.md. State only its definition of sequence convergence in exactly one conceptual step, then finish.',randomUUID());
  await settle();assert.equal(book.threadId,threadId);assert.equal(Object.keys(book.nodes).length,1);
  writeFileSync(join(root,'result.json'),JSON.stringify({threadId,book,verified:['thread/start','turn/start','structured output','local material','Continue','background generation','old-node explanation return','Clear','thread/resume']},null,2));
  console.log(`Live Codex verification passed. Evidence: ${root}/result.json`);
  engine.close();resumedStore.close();
} catch(e) {engine.close();console.error(e);process.exitCode=1;}

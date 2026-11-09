import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexProvider } from '../src/server/codex';
import { Engine } from '../src/server/engine';
import { Store } from '../src/server/store';
const root=mkdtempSync(resolve('.data/model-live-'));
const store=new Store(join(root,'workspace.sqlite')),provider=new CodexProvider(),engine=new Engine(store,provider);
const materialDirectory=join(root,'materials');mkdirSync(materialDirectory);
const book=engine.addBook('Live model selection verification',materialDirectory);
const results:unknown[]=[];
async function settle(){const start=Date.now();while(engine.running.has(book.id)){if(Date.now()-start>330000)throw new Error('Live model test timed out');await new Promise(r=>setTimeout(r,100));}const job=Object.values(book.jobs).at(-1)!;assert.equal(job.status,'completed',job.error);}
try{
 const catalog=await engine.models(book.id);
 const models=catalog.models.filter(m=>m.supportedReasoningEfforts.some(e=>e.reasoningEffort==='low')).slice(0,2);
 assert.equal(models.length,2,'Need two advertised models with low effort for this live check');
 let threadId:string|null=null;
 for(const model of models){
  await engine.configure(book.id,{model:model.model,effort:'low'});
  engine.newTree(book.id,'State the definition of an even integer in exactly one short conceptual step, then finish. No material lookup is needed for this elementary definition.',randomUUID());
  await settle();
  threadId??=book.threadId;assert.equal(book.threadId,threadId);
  const session=provider.sessions.get(book.id)!;
  const metadata=await session.rpc.call('thread/resume',{threadId,excludeTurns:true});
  assert.equal(metadata.model,model.model);assert.equal(metadata.reasoningEffort,'low');
  results.push({requested:book.generation,reported:{model:metadata.model,effort:metadata.reasoningEffort},threadId});
  console.log(`Verified ${model.model} / low on the same live Codex thread.`);
 }
 writeFileSync(join(root,'result.json'),JSON.stringify(results,null,2));
 console.log(`Live model-switch evidence: ${root}/result.json`);
}finally{engine.close();store.close();}

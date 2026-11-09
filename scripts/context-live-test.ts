import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Engine } from '../src/server/engine';
import { CodexProvider } from '../src/server/codex';
import { Store } from '../src/server/store';
import { currentTree, nodeAt, type GenerationMetrics } from '../src/shared/types';
mkdirSync('.data',{recursive:true});
const root=mkdtempSync(resolve('.data/context-live-')),material=mkdtempSync(join(tmpdir(),'lemma-context-material-')),path=join(root,'workspace.sqlite');
copyFileSync('examples/materials/convergence.md',join(material,'convergence.md'));
writeFileSync(join(material,'STUDY_PROGRESS.md'),'# Study progress\n\nPersonal convention: keep a Next time section.\n');
let store=new Store(path),provider=new CodexProvider(join(root,'context')),engine=new Engine(store,provider),book=engine.addBook('Context continuity verification',material);
const measurements:{kind:string;metrics?:GenerationMetrics}[]=[];
const uid=()=>randomUUID();
async function settle(){const end=Date.now()+360000;while(engine.running.size||Object.values(book.jobs).some(j=>j.status==='queued')){if(Date.now()>end)throw new Error('Live verification timed out');await new Promise(r=>setTimeout(r,200));}const j=Object.values(book.jobs).at(-1)!;if(j.status!=='completed')throw new Error(j.error||j.status);measurements.push({kind:j.kind,metrics:j.metrics});console.log(JSON.stringify(measurements.at(-1)));}
try{
 const catalog=await engine.models(book.id),option=catalog.models.find(m=>m.model===catalog.defaultModel);
 if(option?.supportedReasoningEfforts.some(e=>e.reasoningEffort==='low'))await engine.configure(book.id,{model:null,effort:'low'});
 engine.newTree(book.id,'Read convergence.md. Teach the proof of its proposition in exactly three conceptual steps. Generate only the first two now, leaving the final verification for step three.',uid());await settle();assert.equal(Object.keys(book.nodes).length,2);const thread=book.threadId;assert.ok(thread);
 const first=nodeAt(book,currentTree(book)!.cursor)!;
 engine.continue(book.id,first.id,currentTree(book)!.cursorEpoch,uid());await settle();assert.equal(Object.keys(book.nodes).length,3);assert.equal(book.threadId,thread);
 provider.catalogs.get(book.directory)!.expires=0;
 engine.comment(book.id,first.id,`Why may the threshold depend on epsilon? Answer in exactly one step. For this integration check, use a local command to read only nodes['${first.id}'].content from the lookup JSON before answering.`,uid());await settle();const q=Object.values(book.questions)[0],position=currentTree(book)!.cursor;engine.enter(book.id,q.id,uid());engine.continue(book.id,nodeAt(book,currentTree(book)!.cursor)!.id,currentTree(book)!.cursorEpoch,uid());assert.deepEqual(currentTree(book)!.cursor,position);
 assert.ok(measurements.at(-1)!.metrics!.commands>0,'Exact lookup was not consulted');
 engine.document(book.id,'progress','Update the progress using actual completed/current/prepared states; preserve the existing personal convention. Do not claim all three main proof steps have been studied.',uid());await settle();assert.match(readFileSync(join(material,'STUDY_PROGRESS.md'),'utf8'),/Next time/i);
 const beforeClear=structuredClone(book);engine.clear(book.id);engine.close();store.close();
 store=new Store(path);provider=new CodexProvider(join(root,'context'));engine=new Engine(store,provider);book=engine.book(book.id);
 engine.newTree(book.id,'Using the existing conversation about convergence, state its definition in exactly one short conceptual step, then finish. The canvas was cleared; do not link to old nodes. No need to reread unchanged textbook material.',uid());await settle();assert.equal(book.threadId,thread);assert.equal(Object.keys(book.nodes).length,1);assert.equal(book.epoch,1);
 assert.deepEqual(readdirSync(join(root,'context')),[]);
 writeFileSync(join(root,'result.json'),JSON.stringify({thread,material,measurements,beforeClear,book},null,2));
 console.log(`Real context lookup, continuation, progress update, Clear and thread/resume passed: ${root}/result.json`);
}finally{engine.close();store.close();}

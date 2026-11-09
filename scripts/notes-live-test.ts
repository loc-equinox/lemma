import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Store } from '../src/server/store';
import { Engine } from '../src/server/engine';
import { CodexProvider } from '../src/server/codex';
mkdirSync('.data',{recursive:true});
const root=mkdtempSync(resolve('.data/notes-live-')),material=mkdtempSync(join(tmpdir(),'lemma-notes-live-'));
copyFileSync('examples/materials/convergence.md',join(material,'convergence.md'));
const store=new Store(join(root,'workspace.sqlite')),provider=new CodexProvider(),engine=new Engine(store,provider),book=engine.addBook('Document integration verification',material);
let last='';engine.on('change',()=>{const j=Object.values(book.jobs).at(-1);const status=j?`${j.kind}: ${j.status} ${j.error||''}`:'';if(status!==last){last=status;console.log(status);}});
async function settle(){const deadline=Date.now()+360000;while(engine.running.size||Object.values(book.jobs).some(j=>j.status==='queued')){if(Date.now()>deadline)throw new Error('Timed out');await new Promise(r=>setTimeout(r,200));}const failed=Object.values(book.jobs).find(j=>j.status==='failed');if(failed)throw new Error(failed.error);}
try{
 engine.document(book.id,'notes','Read convergence.md and prepare a concise reference of its definition and proposition, including hypotheses and the key proof idea. This is a preview; no learning steps have been completed yet.',randomUUID(),'Chapter 1 — Convergence');await settle();
 assert.equal(Object.keys(book.trees).length,0);assert.equal(book.activeTreeId,null);const ref=Object.values(book.references)[0];assert.equal(ref.kind,'reference');assert.ok(readFileSync(join(material,'STUDY_NOTES.md'),'utf8').includes(ref.content));const thread=book.threadId;assert.ok(thread);
 engine.document(book.id,'progress','Update the study progress. Mention the prepared chapter reference and an appropriate starting point; do not claim any learning steps have been completed.',randomUUID());await settle();assert.equal(book.threadId,thread);assert.ok(readFileSync(join(material,'STUDY_PROGRESS.md'),'utf8').trim());
 engine.newTree(book.id,'Use the saved study documents to identify where we should start. Give one short conceptual step about the definition in convergence.md, then finish this request.',randomUUID());await settle();assert.equal(book.threadId,thread);assert.equal(Object.keys(book.nodes).length,1);
 writeFileSync(join(root,'result.json'),JSON.stringify({material,book,notes:readFileSync(join(material,'STUDY_NOTES.md'),'utf8'),progress:readFileSync(join(material,'STUDY_PROGRESS.md'),'utf8')},null,2));
 console.log(`Actual Codex notes, progress and subsequent learning passed: ${root}/result.json`);
}finally{engine.close();store.close();}

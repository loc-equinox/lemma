import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Engine, type GenerationContext, type Provider } from '../src/server/engine';
import { Store } from '../src/server/store';
import { documentFile, instructionKind, type DocumentOutput } from '../src/shared/documents';
import type { Output } from '../src/shared/types';
import { currentTree, nodeAt } from '../src/shared/types';
import { saveDocument, readDocument } from '../src/server/documents';
class Controlled implements Provider {
 calls:{ctx:GenerationContext;signal:AbortSignal;resolve:(o:Output|DocumentOutput)=>void}[]=[];
 generate(ctx:GenerationContext,signal:AbortSignal,_progress:(s:string)=>void,thread:(s:string)=>void):Promise<Output|DocumentOutput>{thread(ctx.book.threadId||'notes-thread');return new Promise(resolve=>this.calls.push({ctx,signal,resolve}));}
 async finish(i:number,content='Chapter conclusions: $x=x$.'){
  const {ctx}=this.calls[i],{job,ids,parentId}=ctx;
  this.calls[i].resolve(job.kind==='notes'||job.kind==='progress'?{jobId:job.id,file:documentFile(job.kind),title:job.sectionTitle||'Study progress',content}:{jobId:job.id,routeId:job.routeId,finished:false,continuation:null,revisions:[],steps:ids.map((id,i)=>({id,title:'Concept',content,parentId:i?ids[i-1]:parentId,nextId:ids[i+1]||null}))});await new Promise(r=>setImmediate(r));
 }
}
function setup(){const root=mkdtempSync(join(tmpdir(),'lemma-docs-')),path=join(root,'state.sqlite'),material=mkdtempSync(join(tmpdir(),'lemma-material-')),store=new Store(path),provider=new Controlled(),engine=new Engine(store,provider),book=engine.addBook('Notes tests',material);return{path,material,store,provider,engine,book,close(){engine.close();store.close();}};}
const uid=()=>randomUUID();
test('notes preserve existing text and other chapters; reference versions, prompt context and Clear round trip',async()=>{
 const f=setup();try{const {engine:e,book:b,provider:p,material}=f;writeFileSync(join(material,'STUDY_NOTES.md'),'# Existing CLI notes\n\nDo not discard this.\n');
 e.newTree(b.id,'Learn',uid());await p.finish(0);const cursor=JSON.stringify(currentTree(b)!.cursor);
 const action=uid();e.document(b.id,'notes','Summarize chapter one',action,'Chapter 1');e.document(b.id,'notes','Duplicate',action,'Chapter 1');assert.equal(p.calls.length,2);await p.finish(1,'# Chapter 1\n\nFirst chapter');
 assert.equal(JSON.stringify(currentTree(b)!.cursor),cursor);assert.equal(Object.keys(b.nodes).length,2);let ref=Object.values(b.references)[0];assert.equal(ref.kind,'reference');assert.equal('completed' in ref,false);assert.equal(ref.content,'First chapter');assert.ok(readFileSync(join(material,'STUDY_NOTES.md'),'utf8').includes('Do not discard this.'));
 e.document(b.id,'notes','Chapter two',uid(),'Chapter 2');await p.finish(2,'Second chapter');e.document(b.id,'notes','Update chapter one',uid(),'Chapter 1');await p.finish(3,'Revised chapter');
 const text=readFileSync(join(material,'STUDY_NOTES.md'),'utf8');assert.match(text,/Second chapter/);assert.match(text,/Revised chapter/);assert.doesNotMatch(text,/First chapter/);assert.ok(ref.supersededBy);assert.equal(b.references[ref.supersededBy!].version,2);assert.equal(ref.content,'First chapter');
 const count=(f.store.db.prepare('SELECT count(*) AS n FROM document_writes').get() as any).n;assert.equal(count,3);
 e.clear(b.id);assert.equal(Object.keys(b.references).length,0);assert.equal(readFileSync(join(material,'STUDY_NOTES.md'),'utf8'),text);assert.equal(b.threadId,'notes-thread');
 e.importDocument(b.id,'STUDY_NOTES.md');assert.equal(Object.keys(b.references).length,3);assert.equal(Object.keys(b.trees).length,0);
 e.newTree(b.id,'Continue from notes',uid());assert.equal(p.calls[4].ctx.documents!.find(d=>d.file==='STUDY_NOTES.md')!.content,text);await p.finish(4);
 }finally{f.close();}
});
test('progress saves full document, keeps previous version in journal and reads both documents',async()=>{
 const f=setup();try{writeFileSync(join(f.material,'STUDY_PROGRESS.md'),'Old progress');f.engine.document(f.book.id,'progress','Update progress',uid());assert.equal(f.provider.calls[0].ctx.documents![0].content,'Old progress');await f.provider.finish(0,'# Current progress\n\nNot yet read: next step.');assert.match(readFileSync(join(f.material,'STUDY_PROGRESS.md'),'utf8'),/Current progress/);assert.equal((f.store.db.prepare('SELECT before_body FROM document_writes').get() as any).before_body,'Old progress');assert.equal(f.book.activeTreeId,null);}finally{f.close();}
});
test('external edits cause a visible failure without overwrite; retry snapshots latest contents',async()=>{
 const f=setup();try{f.engine.document(f.book.id,'notes','Notes',uid(),'Ch 1');writeFileSync(join(f.material,'STUDY_NOTES.md'),'External edit');await f.provider.finish(0);assert.equal(readFileSync(join(f.material,'STUDY_NOTES.md'),'utf8'),'External edit');assert.equal(Object.keys(f.book.references).length,0);const j=Object.values(f.book.jobs)[0];assert.equal(j.status,'failed');assert.match(j.error!,/changed/);f.engine.retry(f.book.id,j.id);assert.equal(f.provider.calls[1].ctx.documents![1].content,'External edit');await f.provider.finish(1);assert.match(readFileSync(join(f.material,'STUDY_NOTES.md'),'utf8'),/^External edit/);}finally{f.close();}
});
test('Clear cancels pending document writes and rejects late results',async()=>{
 const f=setup();try{f.engine.document(f.book.id,'notes','Notes',uid(),'Ch 1');f.engine.clear(f.book.id);assert.ok(f.provider.calls[0].signal.aborted);await f.provider.finish(0);assert.equal(existsSync(join(f.material,'STUDY_NOTES.md')),false);assert.equal(Object.keys(f.book.references).length,0);}finally{f.close();}
});
test('questions on references return to the saved active position and can start with no learning tree',async()=>{
 const f=setup();try{const {engine:e,book:b,provider:p}=f;e.document(b.id,'notes','Notes',uid(),'Ch 1');await p.finish(0);const ref=Object.values(b.references)[0];e.comment(b.id,ref.id,'Explain',uid());assert.equal(Object.values(b.questions)[0].returnTo,null);assert.equal(currentTree(b)!.cursor,null);await p.finish(1);e.enter(b.id,Object.values(b.questions)[0].id,uid());assert.ok(nodeAt(b,currentTree(b)!.cursor));
 const active=nodeAt(b,currentTree(b)!.cursor)!.id;e.comment(b.id,ref.id,'Again',uid());assert.equal(nodeAt(b,Object.values(b.questions)[1].returnTo)!.id,active);assert.equal('completed' in ref,false);await p.finish(2);
 }finally{f.close();}
});
test('rejects symlink targets and mismatched output identities',async()=>{
 const f=setup();try{const external=join(tmpdir(),`lemma-external-${uid()}`);writeFileSync(external,'External data');symlinkSync(external,join(f.material,'STUDY_NOTES.md'));f.engine.document(f.book.id,'notes','Notes',uid());assert.equal(Object.values(f.book.jobs)[0].status,'failed');assert.equal(f.provider.calls.length,0);assert.equal(readFileSync(external,'utf8'),'External data');}finally{f.close();}
 const g=setup();try{g.engine.document(g.book.id,'notes','Notes',uid());g.provider.calls[0].resolve({jobId:'wrong',file:'STUDY_PROGRESS.md',title:'Wrong',content:'Wrong'});await new Promise(r=>setImmediate(r));assert.equal(Object.values(g.book.jobs)[0].status,'failed');assert.equal(existsSync(join(g.material,'STUDY_PROGRESS.md')),false);}finally{g.close();}
});
test('restart recovers a file committed just before application state was saved',()=>{
 const f=setup();f.engine.document(f.book.id,'notes','Notes',uid(),'Recovery');const job=Object.values(f.book.jobs)[0];const reference=saveDocument(f.store.db,f.book,job,{jobId:job.id,file:'STUDY_NOTES.md',title:'Recovery',content:'Recovered text'},readDocument(f.material,'STUDY_NOTES.md'));f.engine.close();f.store.close();const store=new Store(f.path);try{const b=store.state.books[f.book.id];assert.equal(b.references[reference.id].content,'Recovered text');assert.equal(b.jobs[job.id].status,'completed');}finally{store.close();}
});
test('explicit GUI commands route to document tasks',()=>{
 assert.equal(instructionKind('/notes 第三章'),'notes');assert.equal(instructionKind('请更新学习进度'),'progress');assert.equal(instructionKind('更新 STUDY_NOTES.md，整理本章的重要结论'),'notes');assert.equal(instructionKind('Explain the notation in STUDY_NOTES.md'),null);assert.equal(instructionKind('解释更新 STUDY_PROGRESS.md 是什么意思'),null);assert.equal(instructionKind('   /notes Chapter 1'),'notes');
});
test('document request preempts speculative generation while preserving its reading cursor',async()=>{
 const f=setup();try{const {engine:e,book:b,provider:p}=f;e.newTree(b.id,'Learn',uid());await p.finish(0);e.continue(b.id,nodeAt(b,currentTree(b)!.cursor)!.id,currentTree(b)!.cursorEpoch,uid());const position=JSON.stringify(currentTree(b)!.cursor);e.document(b.id,'notes','整理这一章的重要结论',uid(),'Chapter');assert.ok(p.calls[1].signal.aborted);await p.finish(1);assert.equal(Object.keys(b.nodes).length,2);assert.equal(p.calls[2].ctx.job.kind,'notes');await p.finish(2);assert.equal(JSON.stringify(currentTree(b)!.cursor),position);assert.equal(Object.keys(b.references).length,1);assert.equal(p.calls[3].ctx.job.kind,'background');await p.finish(3);}finally{f.close();}
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Engine, type GenerationContext, type Provider } from '../src/server/engine';
import { Store } from '../src/server/store';
import type { Book, Output } from '../src/shared/types';
import { currentTree, nodeAt, successor } from '../src/shared/types';
class Controlled implements Provider {
  calls: { ctx: GenerationContext; signal: AbortSignal; resolve: (o: Output) => void; reject: (e: Error) => void }[] = [];
  generate(ctx: GenerationContext, signal: AbortSignal, _progress: (s:string)=>void, thread: (s:string)=>void): Promise<Output> {
    thread(ctx.book.threadId || 'persistent-thread');
    return new Promise((resolve,reject)=>this.calls.push({ctx,signal,resolve,reject}));
  }
  output(i: number, finished = false, count?: number): Output {
    const { ctx } = this.calls[i], { book,job,ids,parentId } = ctx;
    const selected = ids.slice(0,count || ids.length);
    return {jobId:job.id,routeId:job.routeId,finished,continuation:finished?book.routes[job.routeId].returnTo:null,revisions:[],steps:selected.map((id,i)=>({id,title:`Concept ${job.start+i+1}`,content:'One rigorous conceptual step: $x=x$.',parentId:i?selected[i-1]:parentId,nextId:selected[i+1]||null}))};
  }
  async finish(i: number, finished = false, count?: number) { this.calls[i].resolve(this.output(i,finished,count)); await tick(); }
}
const tick=()=>new Promise<void>(r=>setImmediate(r));
function setup() {
 const path=join(mkdtempSync(join(tmpdir(),'lemma-test-')),'workspace.sqlite'), store=new Store(path), p=new Controlled(), e=new Engine(store,p), b=e.addBook('Analysis',process.cwd());
 const cleanup=()=>{e.close();store.close();}; return {path,store,p,e,b,cleanup};
}
const action=()=>randomUUID();
const cursor=(b:Book)=>nodeAt(b,currentTree(b)?.cursor||null)!;
const advance=(e:Engine,b:Book)=>e.continue(b.id,cursor(b).id,currentTree(b)!.cursorEpoch,action());
async function initial(f:ReturnType<typeof setup>) { f.e.newTree(f.b.id,'Explain a proof',action()); await f.p.finish(0); }
test('initial two steps; viewing is pure; Continue prefetches exactly one; duplicate protection',async()=>{
 const f=setup(); try {await initial(f); const {e,b,p}=f; assert.equal(Object.keys(b.nodes).length,2); assert.equal(p.calls.length,1);
 const n=cursor(b), epoch=currentTree(b)!.cursorEpoch, a=action(); nodeAt(b,successor(b,n)); assert.equal(cursor(b).id,n.id);
 e.continue(b.id,n.id,epoch,a); e.continue(b.id,n.id,epoch,a); assert.throws(()=>e.continue(b.id,n.id,epoch,action()));
 assert.equal(p.calls.length,2); assert.equal(p.calls[1].ctx.job.count,1); await p.finish(1); assert.equal(Object.keys(b.nodes).length,3); assert.equal(p.calls.length,2);
 }finally{f.cleanup();}
});
test('single explanation explicitly entered, returns to S2 without prefetch beyond return',async()=>{
 const f=setup();try{await initial(f);const {e,b,p}=f, source=cursor(b), next=nodeAt(b,successor(b,source))!;
 e.comment(b.id,source.id,'Why?',action());await p.finish(1,true,1);assert.equal(cursor(b).id,source.id);const q=Object.values(b.questions)[0];
 assert.throws(()=>advance(e,b));e.enter(b.id,q.id,action());assert.ok(source.completed);assert.equal(p.calls.length,2);
 advance(e,b);assert.equal(cursor(b).id,next.id);assert.ok(q.resolved);assert.equal(p.calls.length,3);
 }finally{f.cleanup();}
});
test('multi-step explanation extends one ahead and nested questions return through outer route',async()=>{
 const f=setup();try{await initial(f);const {e,b,p}=f, source=cursor(b), s2=nodeAt(b,successor(b,source))!;
 e.comment(b.id,source.id,'Explain carefully',action());await p.finish(1);const outer=Object.values(b.questions)[0];e.enter(b.id,outer.id,action());
 const a=cursor(b), outerNext=nodeAt(b,successor(b,a))!;
 e.comment(b.id,a.id,'A nested why',action());await p.finish(2,true,1);const inner=Object.values(b.questions)[1];e.enter(b.id,inner.id,action());advance(e,b);
 assert.equal(cursor(b).id,outerNext.id);assert.ok(inner.resolved);assert.equal(p.calls.length,4);await p.finish(3,true);advance(e,b);assert.equal(p.calls.length,4);advance(e,b);assert.equal(cursor(b).id,s2.id);assert.ok(outer.resolved);
 }finally{f.cleanup();}
});
test('old completed nodes accept repeated questions, returning to original active position',async()=>{
 const f=setup();try{await initial(f);const {e,b,p}=f,old=cursor(b);advance(e,b);await p.finish(1);const active=cursor(b);
 for(let i=0;i<2;i++){e.comment(b.id,old.id,`Question ${i}`,action());await p.finish(2+i,true,1);const q=Object.values(b.questions).at(-1)!;e.enter(b.id,q.id,action());advance(e,b);assert.equal(cursor(b).id,active.id);assert.ok(old.completed);}
 assert.equal(Object.keys(b.questions).length,2);
 }finally{f.cleanup();}
});
test('question priority aborts background, ignores late results, preserves valid nodes',async()=>{
 const f=setup();try{await initial(f);const {e,b,p}=f;advance(e,b);const count=Object.keys(b.nodes).length;
 e.comment(b.id,cursor(b).id,'Priority question',action());assert.ok(p.calls[1].signal.aborted);await p.finish(1);assert.equal(Object.keys(b.nodes).length,count);assert.equal(p.calls[2].ctx.job.kind,'question');await p.finish(2,true,1);
 assert.equal(Object.keys(b.nodes).length,count+1);
 }finally{f.cleanup();}
});
test('missing return destinations survive cancellation and are generated when needed',async()=>{
 const f=setup();try{await initial(f);const {e,b,p}=f;advance(e,b);const source=cursor(b);e.comment(b.id,source.id,'Why?',action());await p.finish(1);await p.finish(2,true,1);const q=Object.values(b.questions)[0];
 assert.equal(q.returnTo?.index,2);e.enter(b.id,q.id,action());assert.equal(p.calls.length,4);await p.finish(3);advance(e,b);assert.equal(cursor(b).index,2);
 }finally{f.cleanup();}
});
test('revisions preserve old versions, update route destinations and reject current-node edits atomically',async()=>{
 const f=setup();try{await initial(f);const {e,b,p}=f,source=cursor(b),future=nodeAt(b,successor(b,source))!;e.comment(b.id,source.id,'Correct future error',action());
 const out=p.output(1,true,1);out.revisions=[{nodeId:future.id,expectedVersion:1,title:'Corrected',content:'Correct mathematics.',reason:'A missing hypothesis'}];p.calls[1].resolve(out);await tick();assert.ok(future.supersededBy);assert.equal(nodeAt(b,successor(b,source))!.version,2);assert.equal(b.nodes[future.id].content,'One rigorous conceptual step: $x=x$.');
 e.comment(b.id,source.id,'Invalid correction',action());const invalid=p.output(2,true,1);invalid.revisions=[{...out.revisions[0],nodeId:source.id}];const count=Object.keys(b.nodes).length;p.calls[2].resolve(invalid);await tick();assert.equal(Object.keys(b.nodes).length,count);assert.equal(Object.values(b.jobs).at(-1)!.status,'failed');
 }finally{f.cleanup();}
});
test('multiple trees keep progress and one conversation; Clear rejects late generation',async()=>{
 const f=setup();try{await initial(f);const {e,b,p}=f,first=currentTree(b)!.id;e.newTree(b.id,'Another theorem',action());await p.finish(1);assert.equal(Object.keys(b.trees).length,2);assert.equal(b.threadId,'persistent-thread');e.resume(b.id,first);assert.equal(currentTree(b)!.id,first);
 advance(e,b);e.clear(b.id);await p.finish(2);assert.equal(Object.keys(b.nodes).length,0);assert.equal(Object.keys(b.trees).length,0);assert.equal(b.threadId,'persistent-thread');assert.equal(b.epoch,1);
 e.newTree(b.id,'Fresh',action());await p.finish(3);assert.equal(p.calls[3].ctx.book.epoch,1);assert.equal(b.threadId,'persistent-thread');
 }finally{f.cleanup();}
});
test('restart restores routes, branches and progress; unfinished jobs become retryable',async()=>{
 const f=setup();await initial(f);const {e,b,p}=f;e.comment(b.id,cursor(b).id,'Why',action());await p.finish(1,true,1);e.enter(b.id,Object.values(b.questions)[0].id,action());advance(e,b);const saved=cursor(b).id,thread=b.threadId;e.close();f.store.close();
 const s=new Store(f.path),provider=new Controlled(),recovered=new Engine(s,provider);try{const book=recovered.book(b.id);assert.equal(cursor(book).id,saved);assert.equal(book.threadId,thread);assert.ok(Object.values(book.questions)[0].resolved);const failed=Object.values(book.jobs).find(j=>j.status==='failed')!;assert.ok(failed);recovered.retry(book.id,failed.id);await provider.finish(0);assert.equal(Object.keys(book.nodes).length,4);}finally{recovered.close();s.close();}
});
test('single-step task ends without unbounded background generation',async()=>{
 const f=setup();try{f.e.newTree(f.b.id,'One definition only',action());await f.p.finish(0,true,1);advance(f.e,f.b);assert.equal(currentTree(f.b)!.cursor,null);assert.equal(f.p.calls.length,1);}finally{f.cleanup();}
});
test('malformed output cannot partially mutate the graph; retry uses new job identity',async()=>{
 const f=setup();try{f.e.newTree(f.b.id,'Explain',action());const out=f.p.output(0);out.steps[1].id='invented';f.p.calls[0].resolve(out);await tick();assert.equal(Object.keys(f.b.nodes).length,0);const failed=Object.values(f.b.jobs)[0];assert.equal(failed.status,'failed');f.e.retry(f.b.id,failed.id);await f.p.finish(1);assert.equal(Object.keys(f.b.nodes).length,2);assert.notEqual(f.p.calls[0].ctx.job.id,f.p.calls[1].ctx.job.id);}finally{f.cleanup();}
});
test('question on the final outer explanation resolves both branches when returning',async()=>{
 const f=setup();try{await initial(f);const {e,b,p}=f,source=cursor(b),next=nodeAt(b,successor(b,source))!;e.comment(b.id,source.id,'Outer',action());await p.finish(1,true,1);e.enter(b.id,Object.values(b.questions)[0].id,action());e.comment(b.id,cursor(b).id,'Inner',action());await p.finish(2,true,1);e.enter(b.id,Object.values(b.questions)[1].id,action());advance(e,b);assert.equal(cursor(b).id,next.id);assert.ok(Object.values(b.questions).every(q=>q.resolved));}finally{f.cleanup();}
});
test('Continue before successor generation finishes retains a logical cursor and restores one-step buffer',async()=>{
 const f=setup();try{await initial(f);const {e,b,p}=f;advance(e,b);advance(e,b);assert.equal(cursor(b),undefined);assert.equal(currentTree(b)!.cursor?.index,2);await p.finish(1);assert.equal(cursor(b).index,2);assert.equal(p.calls.length,3);await p.finish(2);assert.equal(p.calls.length,3);}finally{f.cleanup();}
});
test('multiple questions queue FIFO and duplicate comments do not create extra branches',async()=>{
 const f=setup();try{await initial(f);const {e,b,p}=f,n=cursor(b),a=action();e.comment(b.id,n.id,'First',a);e.comment(b.id,n.id,'First',a);e.comment(b.id,n.id,'Second',action());assert.equal(Object.keys(b.questions).length,2);assert.equal(p.calls.length,2);await p.finish(1,true,1);assert.equal(p.calls[2].ctx.book.questions[p.calls[2].ctx.book.routes[p.calls[2].ctx.job.routeId].questionId!].text,'Second');await p.finish(2,true,1);}finally{f.cleanup();}
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareContext } from '../src/server/context';
import type { GenerationContext } from '../src/server/engine';
import type { Book, Job } from '../src/shared/types';
function fixture(count=10):GenerationContext {
 const book:Book={id:'book',name:'Context tests',directory:'/tmp/materials',generation:{model:null,effort:null},threadId:'same-thread',epoch:3,activeTreeId:'tree',trees:{tree:{id:'tree',prompt:'Teach convergence',routeId:'main',cursor:{routeId:'main',index:count-2},cursorEpoch:7,createdAt:''}},routes:{main:{id:'main',treeId:'tree',questionId:null,nodeIds:[],finished:false,returnTo:null}},nodes:{},questions:{},references:{},jobs:{},actions:{}};
 for(let i=0;i<count;i++){const id=`node-${i}`;book.routes.main.nodeIds.push(id);book.nodes[id]={id,routeId:'main',index:i,title:`Concept ${i}`,content:'EXACT_PRIVATE_PROOF_BODY '.repeat(200),parentId:i?`node-${i-1}`:null,version:1,supersededBy:null,completed:i<count-2,createdAt:''};}
 const job:Job={id:'job',epoch:3,routeId:'main',start:count,count:1,kind:'background',status:'running',createdAt:''};
 return {book,job,ids:['new-node'],parentId:`node-${count-1}`,documents:[{file:'STUDY_NOTES.md',content:'EXACT_DURABLE_NOTES '.repeat(10000),hash:'notes-v1'},{file:'STUDY_PROGRESS.md',content:'EXACT_PROGRESS',hash:'progress-v1'}]};
}
test('turn payload stays bounded as history grows; exact content is available only through the local lookup',()=>{
 const root=mkdtempSync(join(tmpdir(),'lemma-context-test-'));
 const small=prepareContext(fixture(10),root),large=prepareContext(fixture(1000),root);
 try{
  const text=JSON.stringify(large.prompt),before=JSON.stringify(small.prompt);
  assert.ok(text.length<before.length+150,`${before.length} -> ${text.length}`);
  assert.doesNotMatch(text,/EXACT_PRIVATE_PROOF_BODY|EXACT_DURABLE_NOTES|EXACT_PROGRESS/);
  const snapshot=JSON.parse(readFileSync(large.prompt.lookup.file,'utf8'));
  assert.equal(Object.keys(snapshot.nodes).length,1000);
  assert.equal(snapshot.nodes['node-0'].content,fixture().book.nodes['node-0'].content);
  assert.equal(snapshot.documents['STUDY_PROGRESS.md'].content,'EXACT_PROGRESS');
  const legacy=JSON.stringify({nodes:Object.values(fixture(1000).book.nodes),studyDocuments:fixture().documents});
  console.log(`Context payload benchmark (1000 fixture nodes): ${Buffer.byteLength(legacy)} -> ${Buffer.byteLength(text)} bytes`);
 }finally{small.dispose();large.dispose();assert.equal(existsSync(large.prompt.lookup.file),false);rmSync(root,{recursive:true});}
});
test('old and nested questions carry the exact source version and saved return without replaying other branches',()=>{
 const ctx=fixture(),b=ctx.book;
 b.questions.q={id:'q',nodeId:'node-0',text:'Explain the epsilon quantifier',routeId:'branch',returnTo:{routeId:'main',index:8},wasCurrent:false,entered:false,resolved:false};
 b.routes.branch={id:'branch',treeId:'tree',questionId:'q',nodeIds:[],finished:false,returnTo:b.questions.q.returnTo};
 ctx.job={...ctx.job,kind:'question',routeId:'branch',start:0,count:2};ctx.ids=['a','b'];ctx.parentId='node-0';
 b.nodes['node-0'].version=2;b.nodes['node-0'].content='Exact old source '.repeat(800);
 const prepared=prepareContext(ctx);
 try{
  const p=prepared.prompt;assert.ok('questionSource' in p);
  assert.equal(p.questionSource!.version,2);assert.equal(p.questionSource!.content.length,6000);assert.equal(p.questionSource!.truncated,true);
  assert.deepEqual(p.returnTo,{routeId:'main',index:8});assert.deepEqual(p.currentReadingPosition,{routeId:'main',index:8});assert.equal(p.firstParentId,'node-0');
  assert.deepEqual(p.revisionCandidates.nodes.map(n=>n!.id),['node-9']);
  assert.equal(JSON.parse(readFileSync(p.lookup.file,'utf8')).nodes['node-0'].content,b.nodes['node-0'].content);
  b.routes.outer={id:'outer',treeId:'tree',nodeIds:[],questionId:null,finished:false,returnTo:{routeId:'main',index:9}};
  b.questions.q.returnTo={routeId:'outer',index:1};b.routes.branch.returnTo=b.questions.q.returnTo;
  const nested=prepareContext(ctx);try{assert.ok('returnTo' in nested.prompt);assert.deepEqual(nested.prompt.returnTo,{routeId:'outer',index:1});}finally{nested.dispose();}
 }finally{prepared.dispose();}
});
test('document tasks and Clear/resume use fresh lookup snapshots and file hashes without embedding document bodies',()=>{
 const ctx=fixture();ctx.job={...ctx.job,kind:'notes',routeId:'',request:'Summarize chapter 1',sectionTitle:'Chapter 1'};
 const first=prepareContext(ctx);
 try{assert.ok('file' in first.prompt);assert.equal(first.prompt.file,'STUDY_NOTES.md');assert.doesNotMatch(JSON.stringify(first.prompt),/EXACT_/);
  const snapshot=JSON.parse(readFileSync(first.prompt.lookup.file,'utf8'));assert.equal(snapshot.documents['STUDY_PROGRESS.md'].content,'EXACT_PROGRESS');
  ctx.documents![1]={file:'STUDY_PROGRESS.md',content:'Externally changed',hash:'progress-v2'};ctx.book.epoch++;ctx.job.epoch++;ctx.book.trees={};ctx.book.routes={};ctx.book.nodes={};ctx.book.activeTreeId=null;
  const second=prepareContext(ctx);try{assert.equal(second.prompt.canvasEpoch,4);assert.equal(second.prompt.activeReading,null);assert.equal(second.prompt.studyDocuments[1].hash,'progress-v2');assert.deepEqual(JSON.parse(readFileSync(second.prompt.lookup.file,'utf8')).nodes,{});assert.equal(ctx.book.threadId,'same-thread');}finally{second.dispose();}
 }finally{first.dispose();}
});

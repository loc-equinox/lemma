import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
const pause=(ms=50)=>new Promise(r=>setTimeout(r,ms));
async function freePort() {
 const server=createServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const port=(server.address() as {port:number}).port;await new Promise<void>(r=>server.close(()=>r()));return port;
}
test('HTTP workflow: books, SSE, action validation, persistence across process restart and Clear during generation', {timeout:30000}, async()=>{
 const directory=mkdtempSync(join(tmpdir(),'lemma-http-')),port=await freePort(),base=`http://127.0.0.1:${port}`;
 let child:ChildProcess|undefined,logs='';
 async function start(){
  logs='';child=spawn(process.execPath,['--import','tsx','src/server/index.ts'],{env:{...process.env,PORT:String(port),DATA_DIR:directory,AI_PROVIDER:'demo',NODE_ENV:'production'},stdio:['ignore','pipe','pipe']});
  child.stdout!.on('data',d=>logs+=d);child.stderr!.on('data',d=>logs+=d);
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/state')).ok)return;}catch{}await pause();if(child.exitCode!==null)throw new Error(logs);}
  throw new Error('HTTP server did not start: '+logs);
 }
 async function stop(){if(!child||child.exitCode!==null)return;const exited=new Promise(r=>child!.once('exit',r));child.kill('SIGTERM');await exited;}
 async function post(path:string,body:object={}){const r=await fetch(base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200,await r.clone().text());return await r.json();}
 async function state(){return await(await fetch(base+'/api/state')).json();}
 async function until(predicate:(s:any)=>boolean){for(let i=0;i<100;i++){if(predicate(await state()))return;await pause();}throw new Error('State did not settle');}
 try{
  await start();const first=await post('books',{name:'Analysis',directory:resolve('examples/materials')}),second=await post('books',{name:'Another book',directory:resolve('examples/materials')});
  assert.notEqual(first.id,second.id);const path=`books/${first.id}/`;
  const foreign=await fetch(base+'/api/'+path+'clear',{method:'POST',headers:{Origin:'https://foreign.example','Content-Type':'application/json'},body:'{}'});assert.equal(foreign.status,403);
  const invalid=await fetch(base+'/api/'+path+'trees',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:'x'})});assert.equal(invalid.status,400);
  const abort=new AbortController();const events=await fetch(base+'/api/events',{signal:abort.signal});assert.equal(events.headers.get('content-type'),'text/event-stream');const reader=events.body!.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/data: changed/);abort.abort();
  const actionId=randomUUID();await post(path+'trees',{prompt:'Explain convergence',actionId});await post(path+'trees',{prompt:'Explain convergence',actionId});
  await until(s=>Object.keys(s.books[first.id].nodes).length===2);let b=(await state()).books[first.id];assert.equal(Object.keys(b.trees).length,1);const tree=b.trees[b.activeTreeId],source=b.nodes[b.routes[tree.cursor.routeId].nodeIds[0]];
  async function terminalSnapshot(bookId:string) {
   const controller=new AbortController(),response=await fetch(base+`/api/books/${bookId}/terminal`,{signal:controller.signal});
   assert.equal(response.status,200);const stream=response.body!.getReader();let body='';
   try {while(!body.includes('\n\n'))body+=new TextDecoder().decode((await stream.read()).value);return JSON.parse(body.split('data: ')[1].split('\n')[0]);}finally{controller.abort();}
  }
  const observed=await terminalSnapshot(first.id);assert.equal(observed.reset,true);assert.ok(observed.events.some((e:any)=>e.text==='completed'));
  assert.deepEqual((await terminalSnapshot(second.id)).events,[]);
  await post(path+'continue',{nodeId:source.id,epoch:tree.cursorEpoch,actionId:randomUUID()});await until(s=>Object.keys(s.books[first.id].nodes).length===3);
  b=(await state()).books[first.id];const cursor=JSON.stringify(b.trees[b.activeTreeId].cursor),threadId=b.threadId;
  await stop();await start();b=(await state()).books[first.id];assert.equal(JSON.stringify(b.trees[b.activeTreeId].cursor),cursor);assert.equal(b.threadId,threadId);assert.equal(Object.keys(b.nodes).length,3);assert.equal(Object.keys((await state()).books[second.id].trees).length,0);
  await post(path+'comments',{nodeId:source.id,text:'Why?',actionId:randomUUID()});await post(path+'clear');await pause(850);b=(await state()).books[first.id];assert.equal(Object.keys(b.nodes).length,0);assert.equal(b.threadId,threadId);assert.equal(b.directory,first.directory);
  assert.deepEqual((await terminalSnapshot(first.id)).events,[]);
 }finally{await stop();}
});

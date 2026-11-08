import assert from 'node:assert/strict';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Engine } from '../src/server/engine';
import { Store } from '../src/server/store';
import { CodexProvider } from '../src/server/codex';
const directories=readdirSync('.data',{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name.startsWith('live-')).map(d=>resolve('.data',d.name)).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs);
const root=process.argv[2] || directories[0];
if(!root)throw new Error('Run npm run test:live first.');
const store=new Store(join(root,'workspace.sqlite'));
const book=Object.values(store.state.books)[0];
assert.equal(book.name,'Live integration verification','Only use the isolated live-verification workspace');
assert.ok(book.threadId);const originalThread=book.threadId;
const provider=new CodexProvider(),engine=new Engine(store,provider);
const events:string[]=[];
const timeout=Date.now()+60000;
try{
 engine.newTree(book.id,'Read convergence.md and carefully explain a new example of epsilon-N reasoning in two conceptual steps.',randomUUID());
 while(!provider.sessions.get(book.id)){if(Date.now()>timeout)throw new Error('Thread resume timed out');await new Promise(r=>setTimeout(r,10));}
 const {rpc}=provider.sessions.get(book.id)!;
 while (rpc.pending.size) { if (Date.now() > timeout) throw new Error('turn/start did not return'); await new Promise(r=>setTimeout(r,10)); }
 const outcome=new Promise<void>((resolve,reject)=>{
  const timer=setTimeout(()=>{rpc.off('notification',listener);reject(new Error('No interruption confirmation'));},15000);
  function listener(m:any){if(m.method==='turn/completed'&&m.params.threadId===originalThread){events.push(m.params.turn.status);clearTimeout(timer);rpc.off('notification',listener);m.params.turn.status==='interrupted'?resolve():reject(new Error('Turn was not interrupted'));}}
  rpc.on('notification',listener);
 });
 // Wait for the actual turn/start response before testing turn/interrupt.
 engine.clear(book.id);
 await outcome;
 while(engine.running.size)await new Promise(r=>setTimeout(r,10));
 assert.equal(book.threadId,originalThread);assert.equal(Object.keys(book.nodes).length,0);
 writeFileSync(join(root,'interrupt-result.json'),JSON.stringify({threadId:originalThread,events,emptyMap:true},null,2));
 console.log('Actual Codex turn/interrupt confirmed; Clear kept its thread and rejected late results.');
}finally{engine.close();store.close();}

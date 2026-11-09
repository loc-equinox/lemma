import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { prepareContext } from '../src/server/context';
import { readDocuments } from '../src/server/documents';
import { currentTree, type Book, type Job } from '../src/shared/types';
const state=await(await fetch((process.env.TEST_URL || 'http://127.0.0.1:4317')+'/api/state')).json();
const results=[];
for(const book of Object.values(state.books) as Book[]){
 const tree=currentTree(book);if(!tree)continue;
 const route=book.routes[tree.cursor?.routeId || tree.routeId],documents=readDocuments(book.directory);
 const job:Job={id:randomUUID(),epoch:book.epoch,routeId:route.id,start:route.nodeIds.length,count:1,kind:'background',status:'running',createdAt:new Date().toISOString()};
 const prepared=prepareContext({book,job,ids:[randomUUID()],parentId:route.nodeIds.at(-1)||null,documents});
 try{
  // Old prompt contained this entire repeated context, plus instructions and task metadata.
  const legacyContextBytes=Buffer.byteLength(JSON.stringify({studyDocuments:documents,routes:Object.values(book.routes).filter(r=>r.treeId===tree.id),nodes:Object.values(book.nodes).filter(n=>book.routes[n.routeId].treeId===tree.id)}));
  const requestBytes=Buffer.byteLength(JSON.stringify(prepared.prompt));
  results.push({book:book.name,nodes:Object.values(book.nodes).filter(n=>book.routes[n.routeId].treeId===tree.id).length,legacyContextBytes,requestBytes,reductionAtLeast:Math.round((1-requestBytes/legacyContextBytes)*100)+'%'});
 }finally{prepared.dispose();}
}
mkdirSync('.data',{recursive:true});writeFileSync('.data/context-benchmark.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));

#!/usr/bin/env node
import { createInterface } from 'node:readline';
let threadId='fixture-thread',turnId='',timer;
const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line),p=m.params;
 if(m.method==='initialize')return send({id:m.id,result:{userAgent:'test-protocol'}});
 if(m.method==='initialized')return;
 if(m.method==='thread/start'||m.method==='thread/resume'){
  if(p.cwd===undefined||p.sandbox!=='read-only'||p.approvalPolicy!=='never')return send({id:m.id,error:{message:'unsafe thread config'}});
  if(m.method==='thread/resume'&&p.threadId!==threadId)return send({id:m.id,error:{message:'unknown thread'}});
  return send({id:m.id,result:{thread:{id:threadId}}});
 }
 if(m.method==='turn/start'){
  if(!p.outputSchema||p.threadId!==threadId)return send({id:m.id,error:{message:'Missing schema or thread'}});
  const task=JSON.parse(p.input[0].text);turnId='turn-'+task.jobId;
  send({id:m.id,result:{turn:{id:turnId,status:'inProgress'}}});
  send({method:'item/agentMessage/delta',params:{threadId,turnId,delta:'working'}});
  timer=setTimeout(()=>{
   const ids=task.allocatedIds;
   const output={jobId:task.jobId,routeId:task.routeId,finished:true,continuation:task.returnTo,revisions:[],steps:ids.map((id,i)=>({id,title:'Verified conceptual step',content:'$1/n \\to 0$.',parentId:i?ids[i-1]:task.firstParentId,nextId:ids[i+1]||null}))};
   send({method:'item/completed',params:{threadId,turnId,item:{type:'agentMessage',id:'answer',text:JSON.stringify(output)}}});
   send({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}});
  },task.task.includes('slow')?1000:15);return;
 }
 if(m.method==='turn/interrupt'){
  clearTimeout(timer);send({id:m.id,result:{}});send({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'interrupted'}}});return;
 }
 send({id:m.id,error:{message:'Unexpected method '+m.method}});
});

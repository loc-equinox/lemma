import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, Background, Controls, MiniMap, MarkerType, type Node, type Edge } from '@xyflow/react';
import { StepContent } from './StepContent';
import { GenerationControls } from './GenerationControls';
import type { Book, Step, Workspace } from '../shared/types';
import { currentTree, nodeAt, label, successor } from '../shared/types';
import '@xyflow/react/dist/style.css';
import 'katex/dist/katex.min.css';
import './style.css';
type State = Workspace & { provider: string };
const uid = () => crypto.randomUUID();
async function request(path: string, body?: unknown) {
  const res = await fetch('/api/'+path, body ? { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body) } : {});
  const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Request failed'); return data;
}
function graph(book: Book, selected: string | null): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [], edges: Edge[] = [];
  const current = nodeAt(book,currentTree(book)?.cursor || null)?.id;
  let baseY = 0;
  for (const tree of Object.values(book.trees)) {
    const routes = Object.values(book.routes).filter(r=>r.treeId === tree.id);
    const positions = new Map<string,{x:number;y:number}>();
    for (const [lane,r] of routes.entries()) {
      const source = r.questionId ? book.questions[r.questionId].nodeId : null;
      const startX = source ? (positions.get(source)?.x || 0) + 80 : 0;
      r.nodeIds.forEach((id,i) => {
        const n = book.nodes[id], position = { x:startX+i*280, y:baseY+lane*165 }; positions.set(id,position);
        const status = n.id === current ? 'Studying' : n.completed ? 'Completed' : 'Ready';
        nodes.push({id,position, data:{label:<><span className="node-kicker">{label(book,n)} <span>{status}</span></span><strong>{n.title}</strong>{n.version>1 && <small>Revised · v{n.version}</small>}</>},className:`step-node ${status.toLowerCase()} ${selected===id?'selected':''}`,sourcePosition:'right' as any,targetPosition:'left' as any});
        const previous = i ? r.nodeIds[i-1] : source;
        if (previous) edges.push({id:`structure-${id}`,source:previous,target:id,type:'smoothstep',style:{stroke:r.questionId?'#a799c4':'#9cae9e',strokeWidth:1.7},markerEnd:{type:MarkerType.ArrowClosed,color:r.questionId?'#a799c4':'#9cae9e'}});
      });
      if (r.questionId && r.finished && r.nodeIds.length) {
        const target = nodeAt(book,r.returnTo);
        if (target) edges.push({id:`return-${r.id}`,source:r.nodeIds.at(-1)!,target:target.id,type:'smoothstep',label:'return',style:{stroke:'#b0a7bd',strokeDasharray:'5 5'},markerEnd:{type:MarkerType.ArrowClosed,color:'#b0a7bd'}});
      }
      const pending = Object.values(book.jobs).find(j=>j.routeId===r.id && ['running','queued'].includes(j.status));
      if (pending) nodes.push({id:pending.id,position:{x:startX+r.nodeIds.length*280,y:baseY+lane*165},data:{label:<><span className="node-kicker">{r.questionId?'EXPLANATION':'NEXT STEP'}</span><strong className="pulse">Preparing…</strong></>},className:'step-node preparing',selectable:false});
    }
    baseY += Math.max(1,routes.length)*165+100;
  }
  return {nodes,edges};
}
function App() {
  const [state,setState] = useState<State>();
  const [bookId,setBookId] = useState<string|null>(localStorage.getItem('lemma-book'));
  const [selected,setSelected] = useState<string|null>(null);
  const [showAdd,setShowAdd] = useState(false);
  const [error,setError] = useState(''); const [online,setOnline] = useState(true);
  const [busy,setBusy] = useState(false); const [prompt,setPrompt] = useState(''); const [comment,setComment] = useState('');
  const [name,setName] = useState(''); const [directory,setDirectory] = useState('');
  const [clearConfirm,setClearConfirm] = useState(false);
  const [follow,setFollow] = useState(false);
  async function refresh() { const s = await request('state'); setState(s); return s as State; }
  useEffect(()=>{
    let timer: ReturnType<typeof setTimeout> | undefined;
    refresh().catch(e=>setError(e.message));
    const events = new EventSource('/api/events');
    events.onmessage=()=>{ if (!timer) timer=setTimeout(()=>{ timer=undefined; refresh().catch(()=>setOnline(false)); },120); };
    events.onopen=()=>setOnline(true); events.onerror=()=>setOnline(false);
    return ()=>{events.close();clearTimeout(timer);};
  },[]);
  const books = Object.values(state?.books || {});
  const book = (bookId ? state?.books[bookId] : undefined) || books[0];
  const tree = book && currentTree(book);
  const current = book && nodeAt(book,tree?.cursor || null);
  const node = selected && book ? book.nodes[selected] : undefined;
  const activeJobs = book ? Object.values(book.jobs).filter(j=>['running','queued'].includes(j.status)) : [];
  const failedJobs = book ? Object.values(book.jobs).filter(j=>j.status==='failed' && book.routes[j.routeId]?.nodeIds.length===j.start && !Object.values(book.jobs).some(k=>k.id!==j.id && k.routeId===j.routeId && k.start===j.start && ['queued','running','completed'].includes(k.status))) : [];
  const data = useMemo(()=>book ? graph(book,selected) : {nodes:[],edges:[]},[book,selected]);
  useEffect(()=>{ if (follow && current) { setSelected(current.id); setFollow(false); } },[follow,current?.id]);
  useEffect(()=>{setSelected(null);setComment('');setFollow(false);},[book?.id]);
  async function run(fn:()=>Promise<unknown>) { setBusy(true); setError(''); try { await fn(); await refresh(); } catch(e) {setError((e as Error).message);} finally {setBusy(false);} }
  const act = (operation: string, body: object = {}) => request(`books/${book!.id}/${operation}`,{...body,actionId:uid()});
  function navigate(updated: Book) {
    setState(previous => previous ? { ...previous, books: { ...previous.books, [updated.id]: updated } } : previous);
    const destination = nodeAt(updated, currentTree(updated)?.cursor || null);
    setSelected(destination?.id || null);
    setFollow(!destination && !!currentTree(updated)?.cursor);
  }
  const openCurrent = ()=>{if(current)setSelected(current.id);else setFollow(true);};
  const next = node && book ? successor(book,node) : null;
  const nextNode = book ? nodeAt(book,next) : undefined;
  const isCurrent = !!node && node.id===current?.id;
  const questions = book && node ? Object.values(book.questions).filter(q=>q.nodeId===node.id) : [];
  const waitingQuestion = questions.some(q=>!q.entered && q.wasCurrent);
  const returnStep = node && book ? !!book.routes[node.routeId].questionId && book.routes[node.routeId].finished && node.index === book.routes[node.routeId].nodeIds.length-1 : false;
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-symbol">∴</span><div>lemma<small>ONE STEP AT A TIME</small></div></div>
      <div className="sidebar-heading">YOUR BOOKS <button aria-label="Add book" onClick={()=>setShowAdd(true)}>＋</button></div>
      <nav aria-label="Books">{books.map(b=><button className={`book-button ${book?.id===b.id?'active':''}`} key={b.id} aria-label={`Open book ${b.name}`} title={b.name} onClick={()=>{setBookId(b.id);localStorage.setItem('lemma-book',b.id);}}><span className="book-icon">▤</span><span>{b.name}<small>{Object.keys(b.trees).length} learning {Object.keys(b.trees).length===1?'tree':'trees'}</small></span></button>)}</nav>
      <button className="add-book" aria-label="Add another book" title="Add a book" onClick={()=>setShowAdd(true)}>＋ Add a book</button>
      <div className="sidebar-footer"><span className={`connection-dot ${online?'':'offline'}`}/>{online?'Workspace saved locally':'Reconnecting…'}<small>{state?.provider==='demo'?'Demo · fixed sample content':'Powered by your local Codex'}</small></div>
    </aside>
    <main>
      <header className="topbar"><div className="breadcrumbs">Your library <span>/</span> <strong>{book?.name || 'Welcome'}</strong></div><div className="header-actions">{state?.provider==='demo'&&<span className="demo-badge">DEMO</span>}{book&&<button className="subtle" onClick={()=>setClearConfirm(true)}>Clear map</button>}</div></header>
      {error&&<div role="alert" className="error-banner">{error}<button aria-label="Dismiss error" onClick={()=>setError('')}>×</button></div>}
      {!book ? <section className="welcome"><div className="eyebrow">A SPACE TO THINK</div><h1>Understand mathematics.<br/><em>One step at a time.</em></h1><p>Bring a book, follow an idea, and ask questions along the way.<br/>Your learning path takes shape as you read.</p><button className="primary" onClick={()=>setShowAdd(true)}>Add your first book <span>＋</span></button><div className="welcome-preview"><span>01<br/><b>Understand</b></span><i>→</i><span>02<br/><b>Question</b></span><i>→</i><span>03<br/><b>Connect</b></span></div></section> : <>
      <div className="workspace-heading"><div><div className="eyebrow">LEARNING MAP</div><h1>{book.name}</h1><p>{Object.keys(book.trees).length ? 'Follow your curiosity. Each node is one conceptual step.' : 'Every idea starts with a question.'}</p></div>{tree&&<button className="resume-button" onClick={openCurrent}>{current ? `Reading ${label(book,current)} ↗` : tree.cursor ? 'Preparing your step…' : 'Learning task complete ✓'}</button>}</div>
      <div className="workspace-body">
        <section className="map-area" aria-label="Learning graph">
          {!!Object.keys(book.trees).length&&<div className="tree-switcher">{Object.values(book.trees).map(t=><button key={t.id} className={t.id===tree?.id?'active':''} title={t.prompt} disabled={busy} onClick={()=>run(async()=>{navigate(await act('resume',{treeId:t.id}));})}>{t.id===tree?.id?'● ':''}{t.prompt}</button>)}</div>}
          {data.nodes.length ? <ReactFlow key={book.id} nodes={data.nodes} edges={data.edges} fitView fitViewOptions={{padding:.3,maxZoom:1}} minZoom={.15} maxZoom={1.8} nodesDraggable={false} nodesConnectable={false} onNodeClick={(_e,n)=>{if(book.nodes[n.id]){setSelected(n.id);setComment('');}}} proOptions={{hideAttribution:true}}><Background gap={22} size={1} color="#d6d9d1"/><Controls showInteractive={false}/><MiniMap pannable zoomable nodeColor={n=>n.className?.includes('studying')?'#44785d':'#d9ded6'}/></ReactFlow> : <div className="empty-map"><span className="empty-mark">∫</span><h2>A new path through your book</h2><p>Ask about a definition, explore a theorem,<br/>or work through a proof below.</p><button onClick={()=>setPrompt('Explain a central definition from this book, one conceptual step at a time.')}>Explore a definition ↗</button></div>}
          <div className="map-legend"><span><i className="green"/>Studying</span><span><i/>Ready</span><span><i className="complete"/>Completed</span><span className="legend-hint">Scroll to zoom · Drag to pan</span></div>
        </section>
        {node&&<aside className="reader" aria-label="Step reader"><div className="reader-top"><span>{label(book,node)} <i> / {node.completed?'Completed':isCurrent?'Studying':'Preview'}</i></span><button aria-label="Close reader" onClick={()=>setSelected(null)}>×</button></div><article>
          {node.supersededBy&&<div className="revision-notice">This version has been superseded. <button onClick={()=>setSelected(node.supersededBy)}>Read the updated step →</button></div>}
          {node.version>1&&<details className="version-history"><summary>Revised · version {node.version}</summary>{Object.values(book.nodes).filter(n=>n.routeId===node.routeId&&n.index===node.index&&n.id!==node.id).map(n=><button key={n.id} onClick={()=>setSelected(n.id)}>View version {n.version}{n.supersededBy?' (superseded)':''}</button>)}</details>}
          <h2>{node.title}</h2><StepContent content={node.content}/>
          {questions.map(q=><div className="question-card" key={q.id}><span className="eyebrow">YOUR QUESTION {q.resolved?'· RESOLVED':''}</span><p>{q.text}</p>{!q.entered ? <button disabled={busy} onClick={()=>run(async()=>{navigate(await act('enter',{questionId:q.id}));})}>Enter explanation →</button> : <button onClick={()=>{const first=book.routes[q.routeId].nodeIds[0];if(first)setSelected(first);}}>View explanation ↗</button>}</div>)}
          <form className="comment-form" onSubmit={e=>{e.preventDefault();run(async()=>{await act('comments',{nodeId:node.id,text:comment});setComment('');});}}><label htmlFor="comment">Something unclear?</label><textarea id="comment" placeholder="Ask about this step…" value={comment} onChange={e=>setComment(e.target.value)} maxLength={12000}/><button disabled={busy||!comment.trim()}>Comment <span>↗</span></button></form>
          </article><div className="reader-footer">{isCurrent&&!node.supersededBy ? <><small>{waitingQuestion?'Your question has an explanation to enter.':nextNode?`${returnStep?'Return to':'Up next'} ${label(book,nextNode)} · ${nextNode.title}`:next?'The next step will be prepared for you.':'You have reached the end of this learning task.'}</small><button className="primary" disabled={busy||waitingQuestion} onClick={()=>run(async()=>{navigate(await act('continue',{nodeId:node.id,epoch:tree!.cursorEpoch}));})}>{nextNode?`${returnStep?'Return to':'Continue to'} ${label(book,nextNode)}`:next?'Continue':'Complete this task'} <span>→</span></button></> : <><small>Viewing a step leaves your reading position unchanged.</small><button className="primary" onClick={openCurrent}>{current?'Back to current step':'Back to learning route'} <span>↗</span></button></>}</div></aside>}
      </div>
      <div className="bottom-area">
        {state?.provider==='codex'&&<GenerationControls key={book.id} bookId={book.id} settings={book.generation} disabled={busy} active={activeJobs.length>0} onSave={async settings=>{
          setBusy(true);
          try {
            const updated=await request(`books/${book.id}/generation`,settings);
            setState(previous=>previous?{...previous,books:{...previous.books,[updated.id]:updated}}:previous);
          } finally { setBusy(false); }
        }}/>}
        <div role="status" className="generation-status">{activeJobs.length?<><span className="spinner"/>{activeJobs.find(j=>j.status==='running')?.progress || 'Your request is queued…'}</>:tree&&!tree.cursor?<><span className="connection-dot"/>Learning task complete. Start another idea whenever you’re ready.</>:<><span className="connection-dot"/>All changes saved. Your next question is welcome.</>}</div>
        {failedJobs.map(j=><div className="job-error" key={j.id}><span>Generation paused: {j.error}</span><button disabled={busy} onClick={()=>run(()=>act('retry',{jobId:j.id}))}>Retry</button></div>)}
        <form className="prompt-form" onSubmit={e=>{e.preventDefault();run(async()=>{await act('trees',{prompt});setPrompt('');setSelected(null);});}}><span className="prompt-symbol">＋</span><textarea aria-label="New learning prompt" placeholder="What would you like to understand? Start a new learning tree…" value={prompt} onChange={e=>setPrompt(e.target.value)} maxLength={12000} onKeyDown={e=>{if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){e.preventDefault();e.currentTarget.form?.requestSubmit();}}}/><button className="primary" disabled={busy||!prompt.trim()}>Start learning <span>↑</span></button></form><div className="prompt-hint">One idea at a time. Ask for a definition, a proof, or a worked example.</div>
      </div></>}
    </main>
    {showAdd&&<div className="modal-backdrop"><form className="modal" role="dialog" aria-modal="true" aria-labelledby="add-title" onSubmit={e=>{e.preventDefault();run(async()=>{const b=await request('books',{name,directory});setBookId(b.id);localStorage.setItem('lemma-book',b.id);setShowAdd(false);setName('');setDirectory('');});}}><button type="button" className="modal-close" aria-label="Close dialog" onClick={()=>setShowAdd(false)}>×</button><div className="eyebrow">YOUR LIBRARY</div><h2 id="add-title">Add a book</h2><p>Connect a local folder containing your textbook, notes, and teaching instructions.</p><label htmlFor="book-name">Book name</label><input id="book-name" autoFocus value={name} onChange={e=>setName(e.target.value)} required maxLength={100} placeholder="Real Analysis"/><label htmlFor="book-directory">Material directory</label><input id="book-directory" value={directory} onChange={e=>setDirectory(e.target.value)} required placeholder="/Users/you/Books/Real Analysis"/><small>The folder stays in place. Codex reads its materials using your existing local login.</small>{error&&<p role="alert" className="inline-error">{error}</p>}<button className="primary" disabled={busy}>Add book <span>→</span></button></form></div>}
    {clearConfirm&&<div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true"><h2>Clear this map?</h2><p>This removes the current book’s trees, questions, and reading progress. Your book folder and Codex conversation are preserved.</p><div className="modal-actions"><button onClick={()=>setClearConfirm(false)}>Keep learning</button><button className="danger" disabled={busy} onClick={()=>run(async()=>{await act('clear');setClearConfirm(false);setSelected(null);setFollow(false);})}>Clear map</button></div></div></div>}
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);

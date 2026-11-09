import type { Book } from '../shared/types';
import type { ReferenceNode } from '../shared/documents';
import { StepContent } from './StepContent';
export function ReferenceReader({ book, node, expanded, busy, comment, onCommentChange, onAsk, onEnter, onOpen, onClose, onLayout, currentId }: {
  book: Book; node: ReferenceNode; expanded: boolean; busy: boolean; comment: string;
  onCommentChange: (text:string)=>void; onAsk:()=>void; onEnter:(id:string)=>void; onOpen:(id:string)=>void; onClose:()=>void; onLayout:()=>void; currentId?:string;
}) {
  const questions=Object.values(book.questions).filter(q=>q.nodeId===node.id);
  const versions=Object.values(book.references).filter(r=>r.file===node.file&&r.sectionId===node.sectionId&&r.id!==node.id);
  return <aside className={`reader reference-reader ${expanded?'reader-expanded':''}`} aria-label="Reference reader">
    <div className="reader-top"><span>Reference <i>/ Read only</i></span><div className="reader-actions">
      <button className="reader-layout-toggle" aria-label={expanded?'Show reader beside map':'Expand reader over map'} aria-pressed={expanded} onClick={onLayout}>{expanded?'Side by side':'Expand reader'} ⤢</button>
      <button className="reader-close" aria-label="Close reader" onClick={onClose}>Back to map ×</button>
    </div></div>
    <article><div className="reader-content">
      {node.supersededBy&&<div className="revision-notice">A newer reference is available. <button onClick={()=>onOpen(node.supersededBy!)}>Read updated reference →</button></div>}
      <p className="reference-file" title={`${book.directory}/${node.file}`}>{node.file} · version {node.version}</p>
      {versions.length>0&&<details className="version-history"><summary>Reference history</summary>{versions.map(v=><button key={v.id} onClick={()=>onOpen(v.id)}>Version {v.version}{v.supersededBy?' (superseded)':''}</button>)}</details>}
      <h2>{node.title}</h2><StepContent content={node.content}/>
      {questions.map(q=><div className="question-card" key={q.id}><span className="eyebrow">YOUR QUESTION {q.resolved?'· RESOLVED':''}</span><p>{q.text}</p>{!q.entered?<button disabled={busy} onClick={()=>onEnter(q.id)}>Enter explanation →</button>:<button onClick={()=>{const first=book.routes[q.routeId].nodeIds[0];if(first)onOpen(first);}}>View explanation ↗</button>}</div>)}
      <form className="comment-form" onSubmit={e=>{e.preventDefault();onAsk();}}><label htmlFor="reference-question">Ask about this reference</label><textarea id="reference-question" placeholder="Ask about a definition or conclusion…" value={comment} onChange={e=>onCommentChange(e.target.value)} maxLength={12000}/><button disabled={busy||!comment.trim()}>Comment ↗</button></form>
    </div></article>
    <div className="reader-footer"><small>This reference does not advance your reading position. No completion is required.</small>{currentId&&<button className="primary" onClick={()=>onOpen(currentId)}>Back to current step ↗</button>}</div>
  </aside>;
}

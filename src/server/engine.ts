import { documentFile, isDocumentJob, type DocumentKind, type DocumentOutput, type DocumentSnapshot } from '../shared/documents';
import { importedReferences, installReference, readDocuments, saveDocument } from './documents';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { realpathSync, statSync } from 'node:fs';
import type { Book, Job, Output, Ref, Route, Step, GenerationMetrics } from '../shared/types';
import { currentTree, nodeAt, resolveRef } from '../shared/types';
import { Store } from './store';
import { TerminalLog } from './terminal';
import type { TerminalChunk } from '../shared/terminal';
import { defaultGeneration, resolveGeneration, type GenerationSettings, type ModelCatalog } from '../shared/models';
import { outputSchema, documentOutputSchema } from './protocol';
export interface GenerationContext { documents?: DocumentSnapshot[]; book: Book; job: Job; ids: string[]; parentId: string | null }
export interface Provider { listModels?(directory: string): Promise<ModelCatalog>; generate(ctx: GenerationContext, signal: AbortSignal, progress: (message: string) => void, thread: (id: string) => void, report?: (metrics: GenerationMetrics) => void, observe?: (chunk: TerminalChunk) => void): Promise<Output | DocumentOutput>; close?(): void }
const id = () => randomUUID();
const now = () => new Date().toISOString();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export class Engine extends EventEmitter {
  running = new Map<string, { controller: AbortController; job: Job }>();
  stopped = false;
  terminal = new TerminalLog();
  finishJob(b: Book, j: Job) {
    j.endedAt ??= now();
    this.terminal.write(b.id, j.id, { kind: j.status === 'failed' ? 'error' : 'status', text: `${j.status}${j.error ? ': ' + j.error : ''}` });
  }
  constructor(public store: Store, public provider: Provider) { super(); }
  get state() { return this.store.state; }
  save() { this.store.save(); this.emit('change'); }
  book(bookId: string) { const b = this.state.books[bookId]; if (!b) throw new Error('Book not found'); return b; }
  addBook(name: string, directory: string) {
    const path = realpathSync(directory);
    if (!statSync(path).isDirectory()) throw new Error('Select a material directory');
    const b: Book = { references: {}, generation: defaultGeneration(), id: id(), name, directory: path, threadId: null, epoch: 0, activeTreeId: null, trees: {}, routes: {}, nodes: {}, questions: {}, jobs: {}, actions: {} };
    this.state.books[b.id] = b; this.save(); return b;
  }
  async models(bookId: string) {
    const b = this.book(bookId);
    if (!this.provider.listModels) throw new Error('Model selection is unavailable in demo mode.');
    return this.provider.listModels(b.directory);
  }
  async configure(bookId: string, settings: GenerationSettings) {
    const b = this.book(bookId), catalog = await this.models(bookId);
    const resolved = resolveGeneration(catalog, settings);
    const option = catalog.models.find(m => m.model === resolved.model);
    if (settings.model !== null && !option) throw new Error('This model is not in the local Codex catalog. Reload the model list.');
    if (settings.effort !== null && !option?.supportedReasoningEfforts.some(e => e.reasoningEffort === settings.effort)) throw new Error('The selected model does not support this reasoning effort.');
    if (this.stopped) throw new Error('Application is stopping.');
    b.generation = { ...settings }; this.save();
  }
  cancelBackground(b: Book, all = false) {
    for (const j of Object.values(b.jobs)) if ((all || j.kind === 'background') && ['running', 'queued'].includes(j.status)) {
      j.status = 'cancelled'; j.error = all ? 'Map or active task changed.' : 'Paused for your question.';
      this.finishJob(b, j);
      if (this.running.get(b.id)?.job.id === j.id) this.running.get(b.id)!.controller.abort();
    }
  }
  newTree(bookId: string, prompt: string, actionId: string) {
    const b = this.book(bookId); if (b.actions[actionId]) return;
    b.actions[actionId] = true; this.cancelBackground(b);
    const treeId = id(), routeId = id();
    b.routes[routeId] = { id: routeId, treeId, questionId: null, nodeIds: [], finished: false, returnTo: null };
    b.trees[treeId] = { id: treeId, routeId, prompt, cursor: { routeId, index: 0 }, cursorEpoch: 0, createdAt: now() };
    b.activeTreeId = treeId;
    this.queue(b, b.routes[routeId], 'initial', 2); this.save(); this.pump(b.id);
  }
  queue(b: Book, route: Route, kind: Job['kind'], count: number) {
    if (route.finished || Object.values(b.jobs).some(j => j.epoch === b.epoch && j.routeId === route.id && ['queued','running'].includes(j.status))) return;
    const j: Job = { id: id(), epoch: b.epoch, routeId: route.id, start: route.nodeIds.length, count, kind, status: 'queued', createdAt: now() };
    b.jobs[j.id] = j;
  }
  ensureAhead(b: Book) {
    if (Object.values(b.jobs).some(j => isDocumentJob(j) && ['queued','running'].includes(j.status))) return;
    const t = currentTree(b); if (!t?.cursor) return;
    if (Object.values(b.questions).some(q => !q.entered && b.routes[q.routeId].treeId === t.id)) return;
    t.cursor = resolveRef(b, t.cursor); if (!t.cursor) return;
    const r = b.routes[t.cursor.routeId];
    // Do not speculate beyond a saved return target while still in an explanation.
    if (t.cursor.index + 1 < r.nodeIds.length) return;
    if (r.finished) {
      const target = resolveRef(b, { routeId: r.id, index: t.cursor.index + 1 });
      if (target && !nodeAt(b, target)) {
        const destination = b.routes[target.routeId];
        if (!Object.values(b.jobs).some(j => j.routeId === destination.id && j.start === destination.nodeIds.length && j.status === 'failed')) this.queue(b, destination, 'background', 1);
      }
      return;
    }
    const failed = Object.values(b.jobs).some(j => j.routeId === r.id && j.start === r.nodeIds.length && j.status === 'failed');
    if (!failed) this.queue(b, r, 'background', r.nodeIds.length ? 1 : 2);
  }
  continue(bookId: string, nodeId: string, epoch: number, actionId: string) {
    const b = this.book(bookId), t = currentTree(b); if (b.actions[actionId]) return;
    if (!t || t.cursorEpoch !== epoch || nodeAt(b, t.cursor)?.id !== nodeId) throw new Error('Reading position changed. Return to your current step.');
    if (Object.values(b.questions).some(q => !q.entered && q.wasCurrent && q.nodeId === nodeId)) throw new Error('Enter your explanation before continuing.');
    const n = b.nodes[nodeId], r = b.routes[n.routeId];
    b.actions[actionId] = true; n.completed = true;
    if (r.finished && n.index === r.nodeIds.length - 1 && r.questionId) b.questions[r.questionId].resolved = true;
    let target: Ref | null = { routeId: n.routeId, index: n.index + 1 };
    const visited = new Set<string>();
    while (target) {
      const route: Route = b.routes[target.routeId];
      if (!route || visited.has(route.id)) break;
      if (!route.finished || target.index < route.nodeIds.length) break;
      visited.add(route.id);
      if (route.questionId) b.questions[route.questionId].resolved = true;
      target = route.returnTo;
    }
    t.cursor = resolveRef(b, target); t.cursorEpoch++;
    this.ensureAhead(b); this.save(); this.pump(b.id);
  }
  comment(bookId: string, nodeId: string, text: string, actionId: string) {
    const b = this.book(bookId); if (b.actions[actionId]) return;
    const n = b.nodes[nodeId] || b.references[nodeId]; if (!n) throw new Error('Node not found');
    let t = currentTree(b);
    const qid = id(), rid = id();
    if (!t) {
      if (!('kind' in n)) throw new Error('Resume a learning tree first');
      const treeId=id();
      t={id:treeId,prompt:`Question about ${n.title}`,routeId:rid,cursor:null,cursorEpoch:0,createdAt:now()};
      b.trees[treeId]=t; b.activeTreeId=treeId;
    }
    const active = nodeAt(b, t.cursor);
    const wasCurrent = active?.id === n.id;
    const returnTo = wasCurrent && !('kind' in n) ? { routeId: n.routeId, index: n.index + 1 } : t.cursor;
    b.actions[actionId] = true; this.cancelBackground(b);
    b.questions[qid] = { id: qid, nodeId, text, routeId: rid, returnTo, wasCurrent, entered: false, resolved: false };
    b.routes[rid] = { id: rid, treeId: t.id, questionId: qid, nodeIds: [], finished: false, returnTo };
    this.queue(b, b.routes[rid], 'question', 2); this.save(); this.pump(b.id);
  }
  enter(bookId: string, questionId: string, actionId: string) {
    const b = this.book(bookId); if (b.actions[actionId]) return;
    const q = b.questions[questionId]; if (!q) throw new Error('Question not found');
    if (q.entered) return;
    const r = b.routes[q.routeId], t = b.trees[r.treeId];
    b.actions[actionId] = true; this.cancelBackground(b);
    if (q.wasCurrent) b.nodes[q.nodeId].completed = true;
    q.entered = true; b.activeTreeId = t.id; t.cursor = { routeId: r.id, index: 0 }; t.cursorEpoch++;
    this.ensureAhead(b); this.save(); this.pump(b.id);
  }
  resume(bookId: string, treeId: string) {
    const b = this.book(bookId); if (!b.trees[treeId]) throw new Error('Tree not found');
    this.cancelBackground(b); b.activeTreeId = treeId; b.trees[treeId].cursorEpoch++;
    this.ensureAhead(b); this.save(); this.pump(b.id);
  }
  clear(bookId: string) {
    const b = this.book(bookId); this.cancelBackground(b, true); b.epoch++; this.terminal.clear(bookId);
    b.references = {}; b.trees = {}; b.routes = {}; b.nodes = {}; b.questions = {}; b.jobs = {}; b.actions = {}; b.activeTreeId = null;
    this.save();
  }
  document(bookId: string, kind: DocumentKind, request: string, actionId: string, sectionTitle?: string) {
    const b = this.book(bookId); if (b.actions[actionId]) return;
    b.actions[actionId] = true; this.cancelBackground(b);
    const j: Job = { id:id(),epoch:b.epoch,routeId:'',start:0,count:0,kind,request,sectionTitle:sectionTitle?.trim() || undefined,status:'queued',createdAt:now() };
    b.jobs[j.id] = j; this.save(); this.pump(b.id);
  }
  importDocument(bookId: string, file: 'STUDY_NOTES.md' | 'STUDY_PROGRESS.md') {
    const b = this.book(bookId);
    for (const ref of importedReferences(b,file)) installReference(b,ref);
    this.save();
  }
  retry(bookId: string, jobId: string) {
    const b = this.book(bookId), j = b.jobs[jobId];
    if (!j || !['failed','cancelled'].includes(j.status)) throw new Error('Job is not retryable');
    if (isDocumentJob(j)) { this.document(bookId,j.kind,j.request || '',id(),j.sectionTitle); return; }
    const r = b.routes[j.routeId]; if (!r || r.nodeIds.length !== j.start || r.finished) throw new Error('This generation is no longer needed');
    this.queue(b, r, j.kind, j.count); this.save(); this.pump(b.id);
  }
  async pump(bookId: string) {
    if (this.stopped || this.running.has(bookId)) return;
    const b = this.book(bookId);
    const j = Object.values(b.jobs).filter(j => j.status === 'queued').sort((a, z) => Number(a.kind === 'background') - Number(z.kind === 'background'))[0];
    if (!j) return;
    const controller = new AbortController(); this.running.set(bookId, { controller, job: j });
    j.generation = { ...b.generation };
    j.startedAt = now();
    this.terminal.write(b.id, j.id, { kind: 'status', text: `Starting ${j.kind} generation` });
    j.status = 'running'; j.progress = isDocumentJob(j) ? `Preparing ${documentFile(j.kind)}…` : 'Preparing the next conceptual step…'; this.save();
    const route = b.routes[j.routeId];
    const ids = Array.from({ length: j.count }, () => id());
    const parentId = route ? route.nodeIds.at(-1) ?? (route.questionId ? b.questions[route.questionId].nodeId : null) : null;
    try {
      const documents = readDocuments(b.directory);
      const output = await this.provider.generate({ book: structuredClone(b), job: structuredClone(j), ids, parentId, documents }, controller.signal,
        message => { if (j.status === 'running' && b.epoch === j.epoch && j.progress !== message) { j.progress = message; this.terminal.write(b.id, j.id, { kind: 'status', text: message }); this.emit('change'); } },
        threadId => { if (!this.stopped) { b.threadId = threadId; this.save(); } },
        metrics => { if (b.epoch === j.epoch) j.metrics = metrics; },
        chunk => { if (!this.stopped && j.status === 'running' && b.epoch === j.epoch) this.terminal.write(b.id, j.id, chunk); });
      if (controller.signal.aborted || j.status !== 'running' || b.epoch !== j.epoch) return;
      if (isDocumentJob(j)) {
        const result = documentOutputSchema.parse(output);
        const reference = saveDocument(this.store.db,b,j,result,documents.find(d=>d.file===documentFile(j.kind))!);
        installReference(b,reference);
      } else this.commit(b, j, outputSchema.parse(output), ids, parentId);
      j.status = 'completed'; j.progress = undefined; this.finishJob(b, j);
      const t = currentTree(b); if (t) t.cursor = resolveRef(b, t.cursor);
      this.ensureAhead(b); this.save();
      if (isDocumentJob(j)) this.store.db.prepare("UPDATE document_writes SET status='saved' WHERE id=?").run(j.id);
    } catch (error) {
      if (!this.stopped && j.status === 'running' && b.epoch === j.epoch) { j.status = controller.signal.aborted ? 'cancelled' : 'failed'; j.error = error instanceof Error ? error.message : String(error); this.finishJob(b, j); this.save(); }
    } finally { this.running.delete(bookId); if (!this.stopped) this.pump(bookId); }
  }
  commit(b: Book, j: Job, out: Output, ids: string[], parentId: string | null) {
    const r = b.routes[j.routeId];
    if (out.jobId !== j.id || out.routeId !== r.id || r.nodeIds.length !== j.start || out.steps.length > j.count || (!out.finished && out.steps.length !== j.count)) throw new Error('Output did not match the requested generation slots');
    if (!same(out.continuation, out.finished ? r.returnTo : null)) throw new Error('Invalid explanation continuation target');
    out.steps.forEach((s, i) => {
      if (s.id !== ids[i] || s.parentId !== (i ? ids[i-1] : parentId) || s.nextId !== (i < out.steps.length-1 ? ids[i+1] : null)) throw new Error('Invalid node identity or route relationship');
    });
    const currentIds = new Set(Object.values(b.trees).map(t => nodeAt(b,t.cursor)?.id));
    const revisions = new Set<string>();
    for (const rev of out.revisions) {
      const n = b.nodes[rev.nodeId];
      if (j.kind !== 'question' || !n || n.completed || currentIds.has(n.id) || n.supersededBy || n.version !== rev.expectedVersion || revisions.has(n.id) || b.routes[n.routeId].treeId !== r.treeId) throw new Error('Revision targets must be eligible unread nodes in this tree');
      revisions.add(n.id);
    }
    // All validation precedes any graph mutation.
    for (const rev of out.revisions) {
      const n = b.nodes[rev.nodeId], replacement: Step = { ...n, id: id(), title: rev.title, content: rev.content + `\n\n> Revision: ${rev.reason}`, version: n.version + 1, createdAt: now() };
      n.supersededBy = replacement.id; b.nodes[replacement.id] = replacement; b.routes[n.routeId].nodeIds[n.index] = replacement.id;
    }
    out.steps.forEach((s,i) => {
      b.nodes[s.id] = { id: s.id, routeId: r.id, index: j.start + i, title: s.title, content: s.content, parentId: s.parentId, version: 1, supersededBy: null, completed: false, createdAt: now() };
      r.nodeIds.push(s.id);
    });
    r.finished = out.finished;
  }
  close() {
    if (this.stopped) return;
    this.stopped = true;
    for (const b of Object.values(this.state.books)) for (const j of Object.values(b.jobs)) {
      if (j.status === 'running' || j.status === 'queued') { j.status = 'failed'; j.error = 'Application stopped during generation. Retry to continue.'; this.finishJob(b, j); }
    }
    this.save();
    for (const { controller } of this.running.values()) controller.abort();
    this.provider.close?.();
  }
}

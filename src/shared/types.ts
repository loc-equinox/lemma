import type { ReferenceNode } from './documents';
import type { GenerationSettings } from './models';
export type Ref = { routeId: string; index: number };
export type Step = { id: string; routeId: string; index: number; title: string; content: string; parentId: string | null; version: number; supersededBy: string | null; completed: boolean; createdAt: string };
export type Route = { id: string; treeId: string; questionId: string | null; nodeIds: string[]; finished: boolean; returnTo: Ref | null };
export type Question = { id: string; nodeId: string; text: string; routeId: string; returnTo: Ref | null; wasCurrent: boolean; entered: boolean; resolved: boolean };
export type Tree = { id: string; prompt: string; routeId: string; cursor: Ref | null; cursorEpoch: number; createdAt: string };
export type GenerationMetrics = { promptBytes: number; preparationMs: number; submitMs?: number; firstEventMs?: number; totalMs?: number; commands: number };
export type Job = { metrics?: GenerationMetrics; request?: string; sectionTitle?: string; generation?: GenerationSettings; id: string; epoch: number; routeId: string; start: number; count: number; kind: 'initial' | 'background' | 'question' | 'progress' | 'notes'; status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'; error?: string; progress?: string; createdAt: string };
export type Book = { references: Record<string, ReferenceNode>; generation: GenerationSettings; id: string; name: string; directory: string; threadId: string | null; epoch: number; activeTreeId: string | null; trees: Record<string, Tree>; routes: Record<string, Route>; nodes: Record<string, Step>; questions: Record<string, Question>; jobs: Record<string, Job>; actions: Record<string, boolean> };
export type Workspace = { schemaVersion: 1; books: Record<string, Book> };
export type Output = { jobId: string; routeId: string; steps: { id: string; title: string; content: string; parentId: string | null; nextId: string | null }[]; finished: boolean; continuation: Ref | null; revisions: { nodeId: string; expectedVersion: number; title: string; content: string; reason: string }[] };
export function resolveRef(book: Book, ref: Ref | null, seen = new Set<string>()): Ref | null {
  if (!ref) return null;
  const route = book.routes[ref.routeId];
  if (!route || seen.has(route.id)) return null;
  if (ref.index < route.nodeIds.length || !route.finished) return ref;
  seen.add(route.id);
  return resolveRef(book, route.returnTo, seen);
}
export function nodeAt(book: Book, ref: Ref | null): Step | undefined {
  const target = resolveRef(book, ref);
  return target ? book.nodes[book.routes[target.routeId].nodeIds[target.index]] : undefined;
}
export function currentTree(book: Book) { return book.activeTreeId ? book.trees[book.activeTreeId] : undefined; }
export function successor(book: Book, node: Step) { return resolveRef(book, { routeId: node.routeId, index: node.index + 1 }); }
export function label(book: Book, node: Step | ReferenceNode): string {
  if ('kind' in node && node.kind === 'reference') return node.file === 'STUDY_PROGRESS.md' ? 'Progress' : 'Reference';
  const step = node as Step;
  const r = book.routes[step.routeId];
  if (!r.questionId) return `S${step.index + 1}`;
  const q = book.questions[r.questionId];
  const siblings = Object.values(book.questions).filter(x => x.nodeId === q.nodeId);
  return `${label(book, book.nodes[q.nodeId] || book.references[q.nodeId])}.${siblings.indexOf(q) + 1}${String.fromCharCode(97 + step.index)}`;
}

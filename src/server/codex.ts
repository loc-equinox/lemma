import { documentFile, isDocumentJob, type DocumentOutput } from '../shared/documents';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { jsonSchema, teachingRules, documentJsonSchema } from './protocol';
import type { GenerationContext, Provider } from './engine';
import { resolveGeneration, type ModelCatalog, type ModelOption } from '../shared/models';
import type { Output } from '../shared/types';
export class Rpc extends EventEmitter {
  child: ChildProcessWithoutNullStreams;
  pending = new Map<number, { resolve: (x: any) => void; reject: (x: Error) => void; timer: NodeJS.Timeout }>();
  seq = 0; dead = false; diagnostic = '';
  constructor() {
    super();
    this.child = spawn(process.env.CODEX_BIN || 'codex', ['app-server', '--listen', 'stdio://'], { stdio: 'pipe' });
    this.child.stderr.on('data', d => { this.diagnostic = (this.diagnostic + d.toString()).slice(-3000); });
    createInterface({ input: this.child.stdout }).on('line', line => {
      let m: any; try { m = JSON.parse(line); } catch { return; }
      if (m.id !== undefined && !m.method) {
        const p = this.pending.get(m.id); if (!p) return;
        clearTimeout(p.timer); this.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      } else if (m.id !== undefined) {
        // Read-only learning never approves file changes, external tools, or escalation.
        if (m.method === 'item/commandExecution/requestApproval' || m.method === 'item/fileChange/requestApproval') this.send({ id: m.id, result: { decision: 'decline' } });
        else this.send({ id: m.id, error: { code: -32601, message: 'Interactive tool requests are unavailable in the read-only learning session' } });
      } else this.emit('notification', m);
    });
    const fail = (e: Error) => { this.dead = true; for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(e); } this.pending.clear(); this.emit('disconnected', e); };
    this.child.on('error', fail);
    this.child.on('exit', code => fail(new Error(`Codex exited (${code}). Check codex login and CODEX_BIN. ${this.diagnostic.slice(-500)}`)));
    this.child.stdin.on('error', () => {});
  }
  send(m: unknown) { this.child.stdin.write(JSON.stringify(m) + '\n'); }
  call(method: string, params: unknown): Promise<any> {
    if (this.dead) return Promise.reject(new Error('Codex is disconnected'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out`)); }, 60000);
      this.pending.set(id, { resolve, reject, timer }); this.send({ id, method, params });
    });
  }
  async initialize() {
    await this.call('initialize', { clientInfo: { name: 'lemma_math_explainer', title: 'Lemma', version: '1.0.0' }, capabilities: { experimentalApi: true } });
    this.send({ method: 'initialized', params: {} });
  }
  close() { this.child.kill(); }
}
export class CodexProvider implements Provider {
  sessions = new Map<string, { rpc: Rpc; threadId: string }>();
  catalogs = new Map<string, { expires: number; value: Promise<ModelCatalog> }>();
  catalogProcesses = new Set<Rpc>();
  listModels(directory: string): Promise<ModelCatalog> {
    const cached = this.catalogs.get(directory);
    if (cached && cached.expires > Date.now()) return cached.value;
    const value = this.readCatalog(directory);
    this.catalogs.set(directory, { expires: Date.now() + 60000, value });
    void value.catch(() => { if (this.catalogs.get(directory)?.value === value) this.catalogs.delete(directory); });
    return value;
  }
  private async readCatalog(directory: string): Promise<ModelCatalog> {
    const rpc = new Rpc(); this.catalogProcesses.add(rpc);
    try {
      await rpc.initialize();
      const { config } = await rpc.call('config/read', { cwd: directory, includeLayers: false });
      const models: ModelOption[] = [];
      let cursor: string | null = null, recommended: string | null = null;
      const seen = new Set<string>();
      do {
        const page = await rpc.call('model/list', { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) });
        for (const m of page.data) {
          if (m.hidden || (m.inputModalities && !m.inputModalities.includes('text'))) continue;
          if (m.isDefault) recommended = m.model;
          if (!models.some(x => x.model === m.model)) models.push({ model: m.model, displayName: m.displayName, description: m.description || '', defaultReasoningEffort: m.defaultReasoningEffort, supportedReasoningEfforts: m.supportedReasoningEfforts });
        }
        cursor = page.nextCursor;
        if (cursor && seen.has(cursor)) throw new Error('Codex returned a repeated model-list cursor.');
        if (cursor) seen.add(cursor);
      } while (cursor);
      const defaultModel = process.env.CODEX_MODEL || config.model || recommended || models[0]?.model || null;
      const option = models.find(m => m.model === defaultModel);
      const configuredEffort = config.model_reasoning_effort;
      const defaultEffort = option && !option.supportedReasoningEfforts.some(e => e.reasoningEffort === configuredEffort)
        ? option.defaultReasoningEffort : configuredEffort || option?.defaultReasoningEffort || null;
      return { models, defaultModel, defaultEffort };
    } finally { rpc.close(); this.catalogProcesses.delete(rpc); }
  }
  async generate(ctx: GenerationContext, signal: AbortSignal, progress: (s: string) => void, thread: (id: string) => void): Promise<Output | DocumentOutput> {
    const { book, job, ids, parentId } = ctx;
    const generation = resolveGeneration(await this.listModels(book.directory), book.generation);
    if (signal.aborted) throw new Error('Generation interrupted');
    let session = this.sessions.get(book.id);
    if (session?.rpc.dead) { this.sessions.delete(book.id); session = undefined; }
    if (!session) {
      const rpc = new Rpc();
      try {
        await rpc.initialize();
        const params = { cwd: book.directory, approvalPolicy: 'never', sandbox: 'read-only', developerInstructions: teachingRules, ...(generation.model ? { model: generation.model } : {}) };
        const result = book.threadId ? await rpc.call('thread/resume', { ...params, threadId: book.threadId }) : await rpc.call('thread/start', params);
        session = { rpc, threadId: result.thread.id }; this.sessions.set(book.id, session); thread(session.threadId);
      } catch (e) { rpc.close(); throw e; }
    }
    if (signal.aborted) throw new Error('Generation interrupted');
    const { rpc, threadId } = session;
    const r = book.routes[job.routeId];
    const documentTask = isDocumentJob(job);
    const prompt = documentTask ? {
      task: job.request, jobId:job.id, file:documentFile(job.kind as 'notes'|'progress'), sectionTitle:job.sectionTitle || null,
      instruction: job.kind === 'progress'
        ? 'Update the complete STUDY_PROGRESS.md using existing notes and the authoritative reading snapshot. Preserve useful existing semantic history and user conventions. Distinguish completed steps, current study, prepared-but-unread content, and unresolved questions. State the next semantic study point without depending on canvas node IDs. Return Markdown content only through the schema. The application saves the file; do not write files yourself.'
        : 'Prepare a coherent reference summary for the requested chapter/topic. Read the local textbook as needed. Include important definitions, theorem hypotheses and conclusions, key proof ideas, and relevant learning progress. Distinguish an upcoming chapter preview from material already studied. This is a reference document, so the one-concept-per-step limit does not apply. Return only this chapter section body, without repeating its title as a heading and without application section markers. Preserve notation and numbering; avoid duplicating other chapters. The application saves the section to STUDY_NOTES.md and displays the exact same content as a read-only canvas reference. Use the requested sectionTitle as title when supplied. Otherwise reuse the existing application section title for the same chapter/topic when present, so a subsequent update replaces that section. Do not write files yourself.',
      canvasEpoch:book.epoch, studyDocuments:ctx.documents || [], activeTreeId:book.activeTreeId,
      trees:Object.values(book.trees), routes:Object.values(book.routes), nodes:Object.values(book.nodes), questions:Object.values(book.questions),
    } : {
      instruction: 'Produce the next requested conceptual steps. Read relevant materials before explaining. Do not write files. Copy allocated IDs and relationships exactly. For the final step in this batch use nextId:null (a future successor is not allocated). continuation must equal the route returnTo only when finished, otherwise null. Generate all slots unless the task ends earlier. The initial two steps must have distinct conceptual purposes. Do not repeat existing steps.',
      studyDocuments:ctx.documents || [],
      canvasEpoch: book.epoch, jobId: job.id, routeId: r.id, startIndex: job.start,
      allocatedIds: ids, firstParentId: parentId, returnTo: r.returnTo,
      task: book.trees[r.treeId].prompt, question: r.questionId ? book.questions[r.questionId] : null,
      referenceSource: r.questionId ? book.references[book.questions[r.questionId].nodeId] || null : null,
      currentReadingPosition: book.trees[r.treeId].cursor,
      routes: Object.values(book.routes).filter(x => x.treeId === r.treeId),
      nodes: Object.values(book.nodes).filter(n => book.routes[n.routeId].treeId === r.treeId),
      format: 'One meaningful conceptual step per node; Markdown and LaTeX. revisions normally empty. Never revise completed or current nodes. Use exact jobId and routeId.',
    };
    return await new Promise<Output | DocumentOutput>((resolve, reject) => {
      let turnId: string | undefined, finalText = '', settled = false, abortTimer: NodeJS.Timeout | undefined;
      const finish = (error?: Error, output?: Output | DocumentOutput) => {
        if (settled) return; settled = true; clearTimeout(timeout); clearTimeout(abortTimer);
        rpc.off('notification', onEvent); rpc.off('disconnected', onDisconnect); signal.removeEventListener('abort', abort);
        error ? reject(error) : resolve(output!);
      };
      const abort = () => {
        if (turnId) void rpc.call('turn/interrupt', { threadId, turnId }).catch(() => {});
        abortTimer ??= setTimeout(() => { rpc.close(); this.sessions.delete(book.id); finish(new Error('Generation interrupted')); }, 5000);
      };
      const onDisconnect = (e: Error) => finish(e);
      const onEvent = (m: any) => {
        const p = m.params;
        if (p?.threadId !== threadId || (turnId && p.turnId && p.turnId !== turnId)) return;
        if (m.method === 'item/agentMessage/delta') progress('Writing your explanation…');
        if (m.method === 'item/started' && p.item.type === 'commandExecution') progress('Reading local material…');
        if (m.method === 'item/completed' && p.item.type === 'agentMessage') finalText = p.item.text;
        if (m.method === 'turn/completed') {
          if (turnId && p.turn.id !== turnId) return;
          if (p.turn.status !== 'completed' || signal.aborted) return finish(new Error(p.turn.error?.message || `Codex turn ${p.turn.status}`));
          try { finish(undefined, JSON.parse(finalText)); } catch { finish(new Error('Codex returned invalid structured output. Retry this step.')); }
        }
      };
      const timeout = setTimeout(() => { this.sessions.delete(book.id); rpc.close(); finish(new Error('Generation timed out after 5 minutes. Retry to continue.')); }, 300000);
      rpc.on('notification', onEvent); rpc.on('disconnected', onDisconnect); signal.addEventListener('abort', abort, { once: true });
      rpc.call('turn/start', { threadId, ...generation, input: [{ type: 'text', text: JSON.stringify(prompt), text_elements: [] }], outputSchema: documentTask ? documentJsonSchema : jsonSchema }).then(res => { turnId = res.turn.id; if (signal.aborted) abort(); }).catch(e => { this.sessions.delete(book.id); rpc.close(); finish(e); });
    });
  }
  close() { for (const s of this.sessions.values()) s.rpc.close(); this.sessions.clear(); for (const rpc of this.catalogProcesses) rpc.close(); this.catalogProcesses.clear(); this.catalogs.clear(); }
}

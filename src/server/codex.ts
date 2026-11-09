import { isDocumentJob, type DocumentOutput } from '../shared/documents';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { jsonSchema, teachingRules, documentJsonSchema } from './protocol';
import type { GenerationContext, Provider } from './engine';
import { resolveGeneration, type ModelCatalog, type ModelOption } from '../shared/models';
import type { Output, GenerationMetrics } from '../shared/types';
import { prepareContext } from './context';
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
  constructor(private contextDirectory?: string) {}
  sessions = new Map<string, { rpc: Rpc; threadId: string; directory: string }>();
  catalogs = new Map<string, { expires: number; value: Promise<ModelCatalog> }>();
  catalogProcesses = new Set<Rpc>();
  contexts = new Set<() => void>();
  listModels(directory: string): Promise<ModelCatalog> {
    const cached = this.catalogs.get(directory);
    if (cached && cached.expires > Date.now()) return cached.value;
    const rpc = [...this.sessions.values()].find(s => s.directory === directory && !s.rpc.dead)?.rpc;
    const value = this.readCatalog(directory,rpc);
    this.catalogs.set(directory, { expires: Date.now() + 60000, value });
    void value.catch(() => { if (this.catalogs.get(directory)?.value === value) this.catalogs.delete(directory); });
    return value;
  }
  private async generationCatalog(directory: string, rpc: Rpc): Promise<ModelCatalog> {
    // Generation reuses the last catalog. Explicit UI refresh may refresh an expired catalog.
    const cached = this.catalogs.get(directory);
    if (cached) return cached.value;
    const value = this.readCatalog(directory,rpc);
    this.catalogs.set(directory,{expires:Date.now()+60000,value});
    void value.catch(() => { if (this.catalogs.get(directory)?.value===value) this.catalogs.delete(directory); });
    return value;
  }
  private async readCatalog(directory: string, existing?: Rpc): Promise<ModelCatalog> {
    const rpc = existing || new Rpc();
    if (!existing) this.catalogProcesses.add(rpc);
    try {
      if (!existing) await rpc.initialize();
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
    } finally { if (!existing) { rpc.close(); this.catalogProcesses.delete(rpc); } }
  }
  async generate(ctx: GenerationContext, signal: AbortSignal, progress: (s: string) => void, thread: (id: string) => void, report?: (metrics: GenerationMetrics) => void): Promise<Output | DocumentOutput> {
    const started = performance.now();
    const { book, job } = ctx;
    if (signal.aborted) throw new Error('Generation interrupted');
    let session = this.sessions.get(book.id);
    if (session?.rpc.dead) { this.sessions.delete(book.id); session = undefined; }
    let generation;
    if (!session) {
      const rpc = new Rpc();
      try {
        await rpc.initialize();
        generation = resolveGeneration(await this.generationCatalog(book.directory,rpc),book.generation);
        if (signal.aborted) throw new Error('Generation interrupted');
        const params = { cwd: book.directory, approvalPolicy: 'never', sandbox: 'read-only', developerInstructions: teachingRules, ...(generation.model ? { model: generation.model } : {}) };
        const result = book.threadId ? await rpc.call('thread/resume', { ...params, threadId: book.threadId, excludeTurns:true }) : await rpc.call('thread/start', params);
        session = { rpc, threadId: result.thread.id, directory:book.directory }; this.sessions.set(book.id, session); thread(session.threadId);
      } catch (e) { rpc.close(); throw e; }
    } else generation = resolveGeneration(await this.generationCatalog(book.directory,session.rpc),book.generation);
    if (signal.aborted) throw new Error('Generation interrupted');
    const { rpc, threadId } = session;
    const documentTask = isDocumentJob(job);
    const context = prepareContext(ctx,this.contextDirectory);
    this.contexts.add(context.dispose);
    const input = JSON.stringify(context.prompt);
    const submitted = performance.now();
    const metrics: GenerationMetrics = {promptBytes:Buffer.byteLength(input),preparationMs:Math.round(submitted-started),commands:0};
    try {
      return await new Promise<Output | DocumentOutput>((resolve, reject) => {
        let turnId: string | undefined, finalText = '', settled = false, abortTimer: NodeJS.Timeout | undefined;
        const finish = (error?: Error, output?: Output | DocumentOutput) => {
          if (settled) return; settled = true; clearTimeout(timeout); clearTimeout(abortTimer);
          rpc.off('notification', onEvent); rpc.off('disconnected', onDisconnect); signal.removeEventListener('abort', abort);
          metrics.totalMs = Math.round(performance.now()-started);
          report?.({...metrics});
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
          if (m.method === 'item/started' || m.method === 'item/agentMessage/delta') metrics.firstEventMs ??= Math.round(performance.now()-submitted);
          if (m.method === 'item/agentMessage/delta') progress('Writing your explanation…');
          if (m.method === 'item/started' && p.item.type === 'commandExecution') { metrics.commands++; progress('Running a local command…'); }
          if (m.method === 'item/completed' && p.item.type === 'agentMessage') finalText = p.item.text;
          if (m.method === 'turn/completed') {
            if (turnId && p.turn.id !== turnId) return;
            if (p.turn.status !== 'completed' || signal.aborted) return finish(new Error(p.turn.error?.message || `Codex turn ${p.turn.status}`));
            try { finish(undefined, JSON.parse(finalText)); } catch { finish(new Error('Codex returned invalid structured output. Retry this step.')); }
          }
        };
        const timeout = setTimeout(() => { this.sessions.delete(book.id); rpc.close(); finish(new Error('Generation timed out after 5 minutes. Retry to continue.')); }, 300000);
        rpc.on('notification', onEvent); rpc.on('disconnected', onDisconnect); signal.addEventListener('abort', abort, { once: true });
        rpc.call('turn/start', { threadId, ...generation, input: [{ type: 'text', text: input, text_elements: [] }], outputSchema: documentTask ? documentJsonSchema : jsonSchema }).then(res => { turnId = res.turn.id; metrics.submitMs=Math.round(performance.now()-submitted); if (signal.aborted) abort(); }).catch(e => { this.sessions.delete(book.id); rpc.close(); finish(e); });
      });
    } finally { context.dispose(); this.contexts.delete(context.dispose); }
  }
  close() { for (const s of this.sessions.values()) s.rpc.close(); this.sessions.clear(); for (const rpc of this.catalogProcesses) rpc.close(); this.catalogProcesses.clear(); this.catalogs.clear(); for (const dispose of this.contexts) dispose(); this.contexts.clear(); }
}

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import { jsonSchema, teachingRules } from './protocol';
import type { GenerationContext, Provider } from './engine';
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
  async generate(ctx: GenerationContext, signal: AbortSignal, progress: (s: string) => void, thread: (id: string) => void): Promise<Output> {
    const { book, job, ids, parentId } = ctx;
    let session = this.sessions.get(book.id);
    if (session?.rpc.dead) { this.sessions.delete(book.id); session = undefined; }
    if (!session) {
      const rpc = new Rpc();
      try {
        await rpc.initialize();
        const params = { cwd: book.directory, approvalPolicy: 'never', sandbox: 'read-only', developerInstructions: teachingRules, ...(process.env.CODEX_MODEL ? { model: process.env.CODEX_MODEL } : {}) };
        const result = book.threadId ? await rpc.call('thread/resume', { ...params, threadId: book.threadId }) : await rpc.call('thread/start', params);
        session = { rpc, threadId: result.thread.id }; this.sessions.set(book.id, session); thread(session.threadId);
      } catch (e) { rpc.close(); throw e; }
    }
    if (signal.aborted) throw new Error('Generation interrupted');
    const { rpc, threadId } = session;
    const r = book.routes[job.routeId];
    const prompt = {
      instruction: 'Produce the next requested conceptual steps. Read relevant materials before explaining. Do not write files. Copy allocated IDs and relationships exactly. For the final step in this batch use nextId:null (a future successor is not allocated). continuation must equal the route returnTo only when finished, otherwise null. Generate all slots unless the task ends earlier. The initial two steps must have distinct conceptual purposes. Do not repeat existing steps.',
      canvasEpoch: book.epoch, jobId: job.id, routeId: r.id, startIndex: job.start,
      allocatedIds: ids, firstParentId: parentId, returnTo: r.returnTo,
      task: book.trees[r.treeId].prompt, question: r.questionId ? book.questions[r.questionId] : null,
      currentReadingPosition: book.trees[r.treeId].cursor,
      routes: Object.values(book.routes).filter(x => x.treeId === r.treeId),
      nodes: Object.values(book.nodes).filter(n => book.routes[n.routeId].treeId === r.treeId),
      format: 'One meaningful conceptual step per node; Markdown and LaTeX. revisions normally empty. Never revise completed or current nodes. Use exact jobId and routeId.',
    };
    return await new Promise<Output>((resolve, reject) => {
      let turnId: string | undefined, finalText = '', settled = false, abortTimer: NodeJS.Timeout | undefined;
      const finish = (error?: Error, output?: Output) => {
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
      rpc.call('turn/start', { threadId, input: [{ type: 'text', text: JSON.stringify(prompt), text_elements: [] }], outputSchema: jsonSchema }).then(res => { turnId = res.turn.id; if (signal.aborted) abort(); }).catch(e => { this.sessions.delete(book.id); rpc.close(); finish(e); });
    });
  }
  close() { for (const s of this.sessions.values()) s.rpc.close(); this.sessions.clear(); }
}

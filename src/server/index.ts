import express from 'express';
import { resolve, sep } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { z } from 'zod/v4';
import { Store } from './store';
import { Engine } from './engine';
import { CodexProvider } from './codex';
import { DemoProvider } from './demo';
const app = express();
const port = Number(process.env.PORT || 4317);
const dataDir = resolve(process.env.DATA_DIR || '.data');
const demo = process.env.AI_PROVIDER === 'demo';
const store = new Store(resolve(dataDir, 'workspace.sqlite'));
const engine = new Engine(store, demo ? new DemoProvider() : new CodexProvider());
app.disable('x-powered-by');
app.use((req, res, next) => {
  const host = req.headers.host?.split(':')[0];
  if (!host || !['localhost','127.0.0.1','[::1]'].includes(host)) return res.status(403).json({ error: 'Local access only' });
  if (req.headers.origin && ![`http://localhost:${port}`,`http://127.0.0.1:${port}`].includes(req.headers.origin)) return res.status(403).json({ error: 'Origin not allowed' });
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
  next();
});
app.use(express.json({ limit: '128kb' }));
app.get('/api/state', (_req,res) => res.json({ ...engine.state, provider: demo ? 'demo' : 'codex' }));
app.get('/api/events', (req,res) => {
  res.writeHead(200, { 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', Connection:'keep-alive' });
  const update = () => res.write('data: changed\n\n');
  engine.on('change',update); update();
  const ping = setInterval(() => res.write(': heartbeat\n\n'), 15000);
  req.on('close', () => { clearInterval(ping); engine.off('change',update); });
});
const text = z.string().trim().min(1).max(12000);
const action = z.string().uuid();
app.post('/api/books', (req,res) => {
  const input = z.object({ name: text.max(100), directory: text }).parse(req.body);
  const dir = realpathSync(input.directory), project = realpathSync(process.cwd());
  if (dir === project || dir.startsWith(project+sep) && !dir.startsWith(resolve(project,'examples/materials'))) throw new Error('Choose a material directory separate from the application and runtime data');
  if (dir === dataDir || dir.startsWith(dataDir+sep) || dataDir.startsWith(dir+sep)) throw new Error('Book materials and application data must be in separate directories');
  res.json(engine.addBook(input.name, dir));
});
app.get('/api/books/:bookId/models', async (req,res) => res.json(await engine.models(req.params.bookId)));
app.post('/api/books/:bookId/generation', async (req,res) => {
  const settings = z.object({ model: z.string().min(1).max(200).nullable(), effort: z.string().min(1).max(100).nullable() }).strict().parse(req.body);
  await engine.configure(req.params.bookId, settings);
  res.json(engine.book(req.params.bookId));
});
app.post('/api/books/:bookId/:operation', (req,res) => {
  const b = req.params.bookId;
  const body = req.body || {};
  switch(req.params.operation) {
    case 'trees': { const p = z.object({ prompt:text, actionId:action }).parse(body); engine.newTree(b,p.prompt,p.actionId); break; }
    case 'continue': { const p = z.object({ nodeId:text, epoch:z.number().int(), actionId:action }).parse(body); engine.continue(b,p.nodeId,p.epoch,p.actionId); break; }
    case 'comments': { const p = z.object({ nodeId:text, text, actionId:action }).parse(body); engine.comment(b,p.nodeId,p.text,p.actionId); break; }
    case 'enter': { const p = z.object({ questionId:text, actionId:action }).parse(body); engine.enter(b,p.questionId,p.actionId); break; }
    case 'resume': engine.resume(b,text.parse(body.treeId)); break;
    case 'retry': engine.retry(b,text.parse(body.jobId)); break;
    case 'clear': engine.clear(b); break;
    default: return res.status(404).json({error:'Unknown operation'});
  }
  res.json(engine.book(b));
});
app.use('/api',(_req,res) => res.status(404).json({error:'Not found'}));
if (process.env.NODE_ENV === 'production' || (process.env.NODE_ENV !== 'development' && existsSync('dist/index.html'))) {
  app.use(express.static(resolve('dist'))); app.get('/{*path}',(_req,res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true, host: '127.0.0.1', hmr: { host: '127.0.0.1' } }, appType:'spa' });
  app.use(vite.middlewares);
}
app.use((error: unknown,_req: express.Request,res: express.Response,_next: express.NextFunction) => {
  res.status(400).json({ error: error instanceof z.ZodError ? error.issues.map(i=>i.message).join('; ') : error instanceof Error ? error.message : 'Request failed' });
});
const server = app.listen(port,'127.0.0.1', () => console.log(`Lemma is ready at http://127.0.0.1:${port} (${demo ? 'demo' : 'live Codex'})`));
server.on('error', error => { console.error(error.message); engine.close(); store.close(); process.exitCode = 1; });
function shutdown() { engine.close(); server.close(); server.closeAllConnections(); store.close(); process.exit(0); }
process.on('SIGINT',shutdown); process.on('SIGTERM',shutdown);

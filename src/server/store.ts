import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Workspace } from '../shared/types';
export class Store {
  db: DatabaseSync;
  state: Workspace;
  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)');
    const row = this.db.prepare('SELECT body FROM workspace WHERE id=1').get() as { body: string } | undefined;
    this.state = row ? JSON.parse(row.body) : { schemaVersion: 1, books: {} };
    if (this.state.schemaVersion !== 1) throw new Error('Unsupported workspace version');
    for (const book of Object.values(this.state.books)) for (const job of Object.values(book.jobs)) {
      if (job.status === 'running' || job.status === 'queued') { job.status = 'failed'; job.error = 'Application stopped during generation. Retry to continue.'; }
    }
    this.save();
  }
  save() { this.db.prepare('INSERT INTO workspace VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(this.state)); }
  close() { this.db.close(); }
}

import { terminalMaxChars, trimTerminal, type TerminalChunk, type TerminalEvent } from '../shared/terminal';

// Observation only: no SQLite writes, generation callbacks, or workspace notifications.
export class TerminalLog {
  private books = new Map<string, { events: TerminalEvent[]; truncated: boolean; version: number }>();
  private seq = 0;
  read(bookId: string) {
    let log = this.books.get(bookId);
    if (!log) { log = { events: [], truncated: false, version: 0 }; this.books.set(bookId, log); }
    return log;
  }
  write(bookId: string, jobId: string, chunk: TerminalChunk) {
    const log = this.read(bookId);
    const text = chunk.text.length > terminalMaxChars ? chunk.text.slice(-terminalMaxChars) : chunk.text;
    if (text.length !== chunk.text.length) log.truncated = true;
    const events = [...log.events, { ...chunk, text, seq: ++this.seq, jobId, time: new Date().toISOString() }];
    log.events = trimTerminal(events);
    if (log.events.length !== events.length) log.truncated = true;
  }
  clear(bookId: string) {
    const log = this.read(bookId);
    log.events = []; log.truncated = false; log.version++;
  }
}

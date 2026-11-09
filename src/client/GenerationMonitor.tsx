import { useEffect, useMemo, useRef, useState } from 'react';
import type { Job } from '../shared/types';
import { terminalBlocks, trimTerminal, workingTime, type TerminalBatch, type TerminalEvent } from '../shared/terminal';

function Terminal({ bookId, demo, onClose }: { bookId: string; demo: boolean; onClose: () => void }) {
  const [events, setEvents] = useState<TerminalEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [following, setFollowing] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const blocks = useMemo(() => terminalBlocks(events), [events]);
  useEffect(() => {
    const stream = new EventSource(`/api/books/${bookId}/terminal`);
    stream.onopen = () => setConnected(true);
    stream.onerror = () => setConnected(false);
    stream.addEventListener('terminal', message => {
      const batch: TerminalBatch = JSON.parse((message as MessageEvent).data);
      setTruncated(batch.truncated);
      setEvents(previous => trimTerminal(batch.reset ? batch.events : [...previous, ...batch.events.filter(event => event.seq > (previous.at(-1)?.seq ?? 0))]));
    });
    return () => stream.close();
  }, [bookId]);
  useEffect(() => {
    if (following && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [events, following]);
  useEffect(() => {
    const element = viewport.current;
    if (!following || !element) return;
    const observer = new ResizeObserver(() => { element.scrollTop = element.scrollHeight; });
    observer.observe(element);
    return () => observer.disconnect();
  }, [following]);
  const labels = { instructions: 'Session instructions', prompt: 'Sent prompt', message: 'Codex', summary: 'Progress summary', command: 'Tool', output: 'Tool output', status: 'Status', error: 'Error' };
  return <section id="codex-terminal" className="terminal-panel" aria-label="Codex terminal">
    <header className="terminal-header"><strong><span aria-hidden="true">›_</span> {demo ? 'Demo terminal' : 'Codex terminal'}</strong><span className="terminal-connection">{connected ? 'Read only' : 'Reconnecting…'}</span>
      <button onClick={() => setFollowing(!following)} aria-pressed={following}>{following ? 'Following output' : 'Follow output'}</button>
      <button aria-label="Close terminal" onClick={onClose}>×</button>
    </header>
    <div ref={viewport} className="terminal-output" role="log" aria-label="Codex terminal output" aria-live="off" tabIndex={0}
      onScroll={event => { const el = event.currentTarget; setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 24); }}>
      <p className="terminal-note">{truncated ? 'Older output was trimmed. ' : ''}Recent output from this server session. {demo ? 'Demo mode does not send prompts to Codex.' : ''}</p>
      {!blocks.length && <p className="terminal-empty">Output will appear when the next generation starts.</p>}
      {blocks.map(block => <div className={`terminal-entry terminal-${block.kind}`} key={block.key}>
        <div className="terminal-meta"><span>{labels[block.kind]}</span><time>{new Date(block.time).toLocaleTimeString()}</time><span title={block.jobId}>{block.jobId.slice(0, 8)}</span></div>
        {block.kind === 'instructions' ? <details><summary>View session instructions</summary><pre>{block.text}</pre></details> : <pre>{block.text}</pre>}
      </div>)}
    </div>
  </section>;
}

export function GenerationMonitor({ bookId, jobs, complete, demo }: { bookId: string; jobs: Job[]; complete: boolean; demo: boolean }) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('lemma-terminal-open') === 'true'; } catch { return false; } });
  const [now, setNow] = useState(Date.now);
  const running = jobs.find(job => job.status === 'running');
  const queued = jobs.some(job => job.status === 'queued');
  const latest = jobs.at(-1);
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running?.id]);
  function toggle(value: boolean) {
    setOpen(value);
    try { localStorage.setItem('lemma-terminal-open', String(value)); } catch { /* Optional preference. */ }
  }
  return <div className="generation-monitor">
    {open && <Terminal key={bookId} bookId={bookId} demo={demo} onClose={() => toggle(false)}/>}
    <div className="generation-row">
      <div role="status" className="generation-status">
        {running ? <><span className="spinner"/><span className="working-time">Working {workingTime(running.startedAt || running.createdAt, now)}</span><span className="generation-message">{running.progress || 'Waiting for Codex…'}</span></>
          : queued ? <><span className="spinner"/>Your request is queued…</>
          : <><span className="connection-dot"/>{complete ? 'Learning task complete. Start another idea whenever you’re ready.' : 'All changes saved. Your next question is welcome.'}</>}
        {!running && !queued && latest?.startedAt && latest.endedAt && <span className="last-duration">{latest.status} · {workingTime(latest.startedAt, Date.parse(latest.endedAt))}</span>}
      </div>
      <button className="terminal-toggle" aria-controls="codex-terminal" aria-expanded={open} onClick={() => toggle(!open)}><span aria-hidden="true">›_</span> Terminal</button>
    </div>
  </div>;
}

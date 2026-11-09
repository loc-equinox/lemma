export type TerminalChunk = {
  kind: 'instructions' | 'prompt' | 'message' | 'summary' | 'command' | 'output' | 'status' | 'error';
  text: string;
  itemId?: string;
  replace?: boolean;
};
export type TerminalEvent = TerminalChunk & { seq: number; jobId: string; time: string };
export type TerminalBatch = { reset: boolean; events: TerminalEvent[]; truncated: boolean };
export const terminalMaxChars = 512 * 1024;
export const terminalMaxEvents = 2048;

// Bound both the server's replay buffer and each browser's retained transcript.
export function trimTerminal(events: TerminalEvent[]) {
  let size = events.reduce((sum, event) => sum + event.text.length, 0), start = 0;
  while (events.length - start > terminalMaxEvents || size > terminalMaxChars) size -= events[start++].text.length;
  return events.slice(start);
}

export function terminalBlocks(events: TerminalEvent[]) {
  const blocks: (TerminalEvent & { key: string })[] = [];
  const items = new Map<string, number>();
  for (const event of events) {
    const key = `${event.jobId}:${event.kind}:${event.itemId ?? event.seq}`;
    const index = items.get(key);
    if (index === undefined) { items.set(key, blocks.length); blocks.push({ ...event, key }); }
    else blocks[index].text = event.replace ? event.text : blocks[index].text + event.text;
  }
  return blocks;
}

export function workingTime(start: string, end = Date.now()) {
  const seconds = Math.max(0, Math.floor((end - Date.parse(start)) / 1000)) || 0;
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

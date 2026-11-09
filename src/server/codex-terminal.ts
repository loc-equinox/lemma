import type { TerminalChunk } from '../shared/terminal';

// Only user-facing output and tool activity; never serialize auth/config or raw reasoning.
export function observeCodex(method: string, p: any, emit: (chunk: TerminalChunk) => void) {
  const deltas: Record<string, TerminalChunk['kind']> = {
    'item/agentMessage/delta': 'message', 'item/commandExecution/outputDelta': 'output',
    'item/reasoning/summaryTextDelta': 'summary', 'item/plan/delta': 'message',
  };
  if (deltas[method] && typeof p.delta === 'string') {
    emit({ kind: deltas[method], itemId: `${p.itemId}${method.includes('summary') ? ':' + p.summaryIndex : ''}`, text: p.delta });
  }
  if (method === 'error') emit({ kind: 'error', text: `${p.error?.message || 'Codex error'}${p.willRetry ? ' (retrying)' : ''}` });
  if (method !== 'item/started' && method !== 'item/completed') return;
  const item = p.item, done = method === 'item/completed';
  if (item.type === 'commandExecution') {
    if (!done) emit({ kind: 'command', itemId: item.id, text: `${item.cwd}\n$ ${item.command}` });
    else {
      if (typeof item.aggregatedOutput === 'string') emit({ kind: 'output', itemId: item.id, text: item.aggregatedOutput, replace: true });
      emit({ kind: 'status', text: `Command ${item.status} · exit ${item.exitCode ?? 'unknown'}` });
    }
  } else if (done && (item.type === 'agentMessage' || item.type === 'plan')) {
    emit({ kind: 'message', itemId: item.id, text: item.text, replace: true });
  } else if (done && item.type === 'reasoning') {
    item.summary?.forEach((text: string, index: number) => emit({ kind: 'summary', itemId: `${item.id}:${index}`, text, replace: true }));
  } else if (['mcpToolCall', 'dynamicToolCall'].includes(item.type)) {
    emit({ kind: done ? 'output' : 'command', itemId: item.id, text: JSON.stringify(done ? (item.result ?? item.contentItems ?? item.error ?? item.status) : { tool: item.tool, arguments: item.arguments }, null, 2) });
  } else if (!['userMessage', 'agentMessage', 'reasoning', 'plan'].includes(item.type)) {
    emit({ kind: 'status', text: `${item.type} ${done ? 'completed' : 'started'}` });
  }
}

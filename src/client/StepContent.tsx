import { useEffect, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import rehypeKatex from 'rehype-katex';

export function StepContent({ content }: { content: string }) {
  const [format, setFormat] = useState<'rendered' | 'source'>('rendered');
  const [copyStatus, setCopyStatus] = useState('');
  const source = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { setCopyStatus(''); }, [content, format]);

  async function copySource() {
    try {
      await navigator.clipboard.writeText(content);
      if (source.current?.value === content) setCopyStatus('Copied');
    } catch {
      if (source.current?.value !== content) return;
      source.current.focus();
      source.current.select();
      setCopyStatus('Source selected. Press ⌘C or Ctrl+C to copy.');
    }
  }

  return <div className="step-content">
    <div className="content-toolbar">
      <div className="content-format" role="group" aria-label="Content format">
        <button type="button" aria-pressed={format === 'rendered'} onClick={() => setFormat('rendered')}>Rendered</button>
        <button type="button" aria-pressed={format === 'source'} onClick={() => setFormat('source')}>Markdown source</button>
      </div>
      {format === 'source' && <button type="button" className="copy-source" onClick={copySource}>Copy source</button>}
    </div>
    {format === 'source' ? <>
      <p className="source-hint">Select any formula to copy its LaTeX into your question.</p>
      <textarea ref={source} className="markdown-source" aria-label="Markdown source" readOnly spellCheck={false} value={content} rows={Math.min(24, Math.max(10, content.split('\n').length + 2))}/>
      <span className="copy-status" role="status">{copyStatus}</span>
    </> : <div className="math-content"><Markdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>{content}</Markdown></div>}
  </div>;
}

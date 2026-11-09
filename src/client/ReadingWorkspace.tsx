import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';

const storageKey = 'lemma-reader-ratio';
const defaultRatio = 0.4;
const minMapWidth = 180;
const minReaderWidth = 320;
const dividerWidth = 8;

function savedRatio() {
  try {
    const value = Number(localStorage.getItem(storageKey));
    if (Number.isFinite(value) && value > 0 && value < 1) return value;
  } catch { /* Resizing also works when browser storage is unavailable. */ }
  return defaultRatio;
}

export function ReadingWorkspace({ map, children, readerOpen, expanded }: {
  map: ReactNode; children: ReactNode; readerOpen: boolean; expanded: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; readerWidth: number } | null>(null);
  const [ratio, setRatio] = useState(savedRatio);
  const [width, setWidth] = useState(0);
  const [resizing, setResizing] = useState(false);
  const split = readerOpen && !expanded;
  const available = Math.max(minMapWidth + minReaderWidth, width - dividerWidth);
  const maxReaderWidth = Math.max(minReaderWidth, available - minMapWidth);
  const readerWidth = Math.min(maxReaderWidth, Math.max(minReaderWidth, available * ratio));

  useEffect(() => {
    const element = container.current!;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    try { localStorage.setItem(storageKey, String(ratio)); } catch { /* Optional preference. */ }
  }, [ratio]);

  useEffect(() => {
    if (!resizing) return;
    document.documentElement.classList.add('resizing-reader');
    return () => document.documentElement.classList.remove('resizing-reader');
  }, [resizing]);

  function finishDrag() {
    drag.current = null;
    setResizing(false);
  }

  useEffect(() => {
    const narrow = matchMedia('(max-width: 800px)');
    const stop = () => finishDrag();
    window.addEventListener('blur', stop);
    narrow.addEventListener('change', stop);
    return () => { window.removeEventListener('blur', stop); narrow.removeEventListener('change', stop); };
  }, []);

  useEffect(() => { if (!split) finishDrag(); }, [split]);

  function resizeTo(pixels: number) {
    setRatio(Math.min(maxReaderWidth, Math.max(minReaderWidth, pixels)) / available);
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, readerWidth };
    setResizing(true);
  }

  return <div ref={container} className={`workspace-body ${readerOpen ? 'has-reader' : ''} ${split ? 'reader-split' : ''}`}
    style={{ '--reader-width': width ? `${readerWidth}px` : '40%' } as CSSProperties}>
    {map}
    {split && <div className={`reader-divider ${resizing ? 'is-resizing' : ''}`} role="separator" tabIndex={0}
      aria-label="Resize map and reader" aria-orientation="vertical" aria-controls="learning-map"
      aria-valuemin={Math.round(minMapWidth / available * 100)}
      aria-valuemax={Math.round((available - minReaderWidth) / available * 100)}
      aria-valuenow={Math.round((available - readerWidth) / available * 100)}
      aria-valuetext={`Map ${Math.round((available - readerWidth) / available * 100)}%, reader ${Math.round(readerWidth / available * 100)}%`}
      title="Drag to resize · Arrow keys to adjust · Double-click to reset"
      onPointerDown={startDrag}
      onPointerMove={event => {
        const active = drag.current;
        if (active?.pointerId === event.pointerId) resizeTo(active.readerWidth + active.x - event.clientX);
      }}
      onPointerUp={event => {
        if (drag.current?.pointerId !== event.pointerId) return;
        finishDrag();
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
      onDoubleClick={() => setRatio(defaultRatio)}
      onKeyDown={event => {
        const step = available * (event.shiftKey ? 0.1 : 0.02);
        if (event.key === 'ArrowLeft') resizeTo(readerWidth + step);
        else if (event.key === 'ArrowRight') resizeTo(readerWidth - step);
        else if (event.key === 'Home') resizeTo(maxReaderWidth);
        else if (event.key === 'End') resizeTo(minReaderWidth);
        else return;
        event.preventDefault();
      }} />}
    {children}
  </div>;
}

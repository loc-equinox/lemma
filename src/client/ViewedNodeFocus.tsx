import { useEffect, useRef, useState } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';

/** Frame an explicitly opened node after the split reader changes the map's width. */
export function ViewedNodeFocus({ nodeId, enabled }: { nodeId: string | null; enabled: boolean }) {
  const { fitView, getNode } = useReactFlow();
  const ready = useStore(state => {
    const node = state.nodeLookup.get(nodeId || '');
    return !!(node?.measured.width && node.measured.height && state.width && state.height && state.panZoom);
  });
  const focused = useRef<string | null>(null);
  const [wide, setWide] = useState(() => matchMedia('(min-width: 801px)').matches);
  useEffect(() => {
    const media = matchMedia('(min-width: 801px)');
    const update = () => setWide(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!enabled || !wide || !nodeId) { focused.current = null; return; }
    if (!ready || focused.current === nodeId) return;
    // Wait for the flex layout and React Flow's ResizeObserver before fitting.
    let secondFrame = 0;
    const frame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (!getNode(nodeId)) return;
        focused.current = nodeId;
        void fitView({ nodes: [{ id: nodeId }], padding: 0.5, minZoom: 0.15, maxZoom: 1,
          duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250 });
      });
    });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(secondFrame); };
  }, [nodeId, enabled, wide, ready, fitView, getNode]);
  return null;
}

/*
 * React example: a plain client-side React app, no framework wrappers.
 *
 * The rule this file demonstrates: the library needs a real DOM node, and a real DOM
 * node only exists on the client. So the instance is created in an effect, on the node
 * held by a ref — never during render, and never during server rendering. The Next
 * example shows the same rule with an explicit Client Component boundary.
 *
 * Only public API from the README is used here.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { visualRegion } from 'visual-region';

function App() {
  const surfaceRef = useRef(null);
  const regionRef = useRef(null);
  const [status, setStatus] = useState('state: —');

  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return undefined;

    const region = visualRegion({
      // Gestures may start inside the card only; the rest of the page is untouched.
      activation: 'element',
      surface,
      persistent: true,
    });
    regionRef.current = region;
    setStatus(`state: ${region.state}`);

    const unsubscribes = [
      region.on('start', ({ source }) => setStatus(`start (${source})`)),
      region.on('change', ({ bounds }) =>
        setStatus(`dragging ${Math.round(bounds.width)}×${Math.round(bounds.height)}`),
      ),
      region.on('end', ({ bounds }) =>
        setStatus(
          bounds === null
            ? 'end (cancelled)'
            : `region: ${Math.round(bounds.width)}×${Math.round(bounds.height)}`,
        ),
      ),
      region.on('unsupported', ({ reason }) => setStatus(`unsupported: ${reason}`)),
    ];

    // Unmount cleanup. Without it a hot reload or a route change would leave a live
    // instance behind, still listening on a node that is no longer in the document.
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
      region.destroy();
      regionRef.current = null;
    };
  }, []);

  const show = useCallback(() => {
    const region = regionRef.current;
    if (region === null) return;
    const box = surfaceRef.current.getBoundingClientRect();
    // `Bounds` is in viewport coordinates, the same space pointer events use.
    const shown = region.setRegion({
      x: box.left + 16,
      y: box.top + 16,
      width: Math.min(280, box.width - 32),
      height: Math.min(120, box.height - 32),
    });
    setStatus(shown ? 'setRegion → shown' : `setRegion refused (state: ${region.state})`);
  }, []);

  const clear = useCallback(() => {
    regionRef.current?.clearRegion();
    setStatus('clearRegion → nothing is shown');
  }, []);

  const destroy = useCallback(() => {
    const region = regionRef.current;
    if (region === null) return;
    region.destroy();
    regionRef.current = null;
    setStatus(`destroy → state: ${region.state}`);
  }, []);

  return (
    <>
      <h1>visual-region — React example</h1>
      <p className="hint">
        Drag inside the card: only what is inside the region changes, and releasing the pointer puts the page
        back. Clicking the link and selecting the text still work as usual.
      </p>

      <section id="surface" ref={surfaceRef}>
        <p>
          <strong>This card is the surface.</strong>
        </p>
        <p>
          The region inverts the pixels underneath it. Nothing in this DOM is modified: the text, the link and
          the selection behave exactly as they would without the library.
        </p>
        {/* draggable="false": a plain <a> starts the native HTML5 drag, which competes with
            the region gesture. That is the consumer's side to fix, as documented. */}
        <p>
          <a href="https://example.com/" draggable="false" style={{ color: '#fff' }}>
            A link that stays clickable
          </a>
        </p>
      </section>

      <div className="controls">
        <button type="button" id="show" onClick={show}>
          Show a region programmatically
        </button>
        <button type="button" id="clear" onClick={clear}>
          Clear it
        </button>
        <button type="button" id="destroy" onClick={destroy}>
          Destroy the instance
        </button>
      </div>

      <p id="status" role="status">
        {status}
      </p>
    </>
  );
}

const container = document.querySelector('#root');
createRoot(container).render(<App />);

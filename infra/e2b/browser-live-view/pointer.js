// Baked into the sandbox image at /opt/coworker/browser/pointer.js and registered on every
// agent-browser command with --init-script, so it runs once per document (the daemon dedupes
// by path) on every page and tab. It reports pointer activity over console.debug, which the
// agent-browser stream server forwards as `console` messages. The live-view relay turns those
// into `pointer` messages for the panel. This is the single source for the on-screen cursor
// and the caption fallback: it fires for BOTH the agent's synthetic clicks (CDP input still
// dispatches real DOM events) and a human's injected input, so one code path draws both.
(() => {
  const TAG = '__alfera_pointer ';
  const move_throttle_ms = 40;
  let last_move_time = 0;

  function element_name(target) {
    if (!target || typeof target.getAttribute !== 'function') return '';
    const labelled =
      target.getAttribute('aria-label') ||
      target.getAttribute('title') ||
      target.getAttribute('alt') ||
      target.getAttribute('placeholder') ||
      target.getAttribute('name');
    if (labelled) return String(labelled).trim().slice(0, 60);
    const text = (target.innerText || target.value || '').trim();
    if (text) return text.slice(0, 60);
    return (target.tagName || '').toLowerCase();
  }

  function report(kind, event) {
    const now = Date.now();
    if (kind === 'move') {
      if (now - last_move_time < move_throttle_ms) return;
      last_move_time = now;
    }
    // console.debug, not log: the stream forwards every level, and debug keeps this off the
    // page's own visible console noise in normal DevTools use.
    console.debug(
      TAG +
        JSON.stringify({
          kind,
          x: Math.round(event.clientX),
          y: Math.round(event.clientY),
          name: kind === 'move' ? '' : element_name(event.target),
        }),
    );
  }

  addEventListener('mousemove', (event) => report('move', event), true);
  addEventListener('mousedown', (event) => report('down', event), true);
  addEventListener('mouseup', (event) => report('up', event), true);
})();

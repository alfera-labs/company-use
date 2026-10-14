const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const { may_tab_sleep, page_is_in_use } = require('../src/window/tab_sleep.cjs');

const sixteen_minutes = 16 * 60_000;
const long_hidden = { is_in_front: false, is_loading: false, hidden_for_ms: sixteen_minutes };

test('a tab sleeps only after a while out of sight', () => {
  assert.equal(may_tab_sleep({ ...long_hidden, session_state: null }), true);
  assert.equal(may_tab_sleep({ ...long_hidden, session_state: 'done' }), true);
  assert.equal(may_tab_sleep({ ...long_hidden, hidden_for_ms: 60_000 }), false);
  assert.equal(may_tab_sleep({ ...long_hidden, is_in_front: true }), false);
  assert.equal(may_tab_sleep({ ...long_hidden, is_loading: true }), false);
});

test('a tab whose chat is working or waiting for the person never sleeps', () => {
  assert.equal(may_tab_sleep({ ...long_hidden, session_state: 'working' }), false);
  assert.equal(may_tab_sleep({ ...long_hidden, session_state: 'needs_you' }), false);
});

// The page check runs in a real page in the app. Here it reads a stand-in for the page that
// holds only the fields and the stop button the check looks for. A field is one the person can
// see and type in, unless the test says otherwise.
function field(properties) {
  const { aria_hidden = null, is_drawn = true, ...rest } = properties;
  return {
    getAttribute: (name) => (name === 'aria-hidden' ? aria_hidden : null),
    getClientRects: () => (is_drawn ? [{}] : []),
    ...rest,
  };
}

function page_with({ fields = [], is_answering = false }) {
  globalThis.document = {
    querySelectorAll: () => fields.map(field),
    querySelector: () => (is_answering ? {} : null),
  };
}
afterEach(() => delete globalThis.document);

test('a page with text the person has not sent is in use', () => {
  page_with({ fields: [{ type: 'textarea', value: 'half a question' }] });
  assert.equal(page_is_in_use(), true);
  page_with({ fields: [{ textContent: 'typed into a rich text box' }] });
  assert.equal(page_is_in_use(), true);
});

test('a page that is still answering is in use', () => {
  page_with({ is_answering: true });
  assert.equal(page_is_in_use(), true);
});

test('a field the page keeps for itself, out of the sight of the person, does not keep a tab awake', () => {
  page_with({
    fields: [
      { type: 'text', value: 'all', aria_hidden: 'true' },
      { type: 'text', value: 'preset:inherit', is_drawn: false },
      { type: 'text', value: 'a saved name', readOnly: true },
      { type: 'text', value: 'a saved name', disabled: true },
    ],
  });
  assert.equal(page_is_in_use(), false);
});

test('a page with empty fields, ticked boxes and hidden values is not in use', () => {
  page_with({
    fields: [
      { type: 'textarea', value: '  ' },
      { type: 'checkbox', value: 'on' },
      { type: 'hidden', value: 'a-token' },
      { textContent: '' },
    ],
  });
  assert.equal(page_is_in_use(), false);
});

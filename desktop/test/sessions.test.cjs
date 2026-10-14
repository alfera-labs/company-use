const assert = require('node:assert/strict');
const { test } = require('node:test');
const { read_person, read_state, sessions_in_state } = require('../src/sessions.cjs');

test('a chat shows as working, needing the person, or done from its latest run', () => {
  const state_of = (run_status, is_unread = false) =>
    read_state({ latest_run: { run_status }, is_unread });
  assert.equal(state_of('running'), 'working');
  assert.equal(state_of('queued'), 'working');
  assert.equal(state_of('waiting'), 'needs_you');
  assert.equal(state_of('completed', true), 'done');
  assert.equal(state_of('completed', false), null);
  assert.equal(state_of('failed', true), 'needs_you');
  assert.equal(state_of('failed', false), null);
  assert.equal(read_state({ latest_run: null }), null);
  assert.equal(read_state({ latest_run: { run_status: 'running' } }, true), 'needs_you');
});

test('the menu bar lists only the chats in the asked state, with a title for each', () => {
  const sessions = {
    ses_1: { title: 'Chase invoices', state: 'needs_you' },
    ses_2: { title: '', state: 'needs_you' },
    ses_3: { title: 'Weekly report', state: 'working' },
  };
  assert.deepEqual(sessions_in_state(sessions, 'needs_you'), [
    { session_id: 'ses_1', title: 'Chase invoices' },
    { session_id: 'ses_2', title: 'Untitled chat' },
  ]);
  assert.deepEqual(sessions_in_state(sessions, 'done'), []);
});

test('who is signed in is told from what Alfera answers', () => {
  const chats = { status: 200, body: { data: [] } };
  assert.equal(read_person(chats, { status: 200, body: { user: { id: 'user_0000000001' } } }), 'user_0000000001');
  assert.equal(read_person({ status: 401, body: { error: { code: 'unauthorized' } } }, { status: 200, body: { user: null } }), null);
});

test('an Alfera that does not say who is signed in still has one person', () => {
  const chats = { status: 200, body: { data: [] } };
  assert.equal(read_person(chats, { status: 404, body: null }), 'someone');
  assert.equal(read_person(chats, { status: 200, body: { user: null } }), 'someone');
});

test('no clear answer says nothing about who is signed in', () => {
  const nobody_asked = { status: 0, body: null };
  assert.equal(read_person(nobody_asked, nobody_asked), undefined);
  assert.equal(read_person({ status: 502, body: null }, nobody_asked), undefined);
  assert.equal(read_person({ status: 200, body: { error: 'not a list' } }, nobody_asked), undefined);
});

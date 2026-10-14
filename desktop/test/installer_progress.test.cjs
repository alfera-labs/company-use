const assert = require('node:assert/strict');
const { test } = require('node:test');
const { progress_rows } = require('../src/setup/installer_contract.cjs');
const {
  create_line_reader,
  parse_progress_line,
  read_row_states,
  read_run_outcome,
} = require('../src/setup/installer_progress.cjs');

const line = (step, state, extras = {}) => ({ step, state, ...extras });
const install_done = line('install', 'done', { changed: 'yes', address: 'https://a.example.com', install_dir: '/opt/alfera/source/deploy' });

test('a line that comes in two pieces is read as one line', () => {
  const reader = create_line_reader();
  assert.deepEqual(reader.read('{"step":"tools","sta'), []);
  assert.deepEqual(reader.read('te":"started"}\n{"step":"tools","state":"done"}\n{"st'), [
    '{"step":"tools","state":"started"}',
    '{"step":"tools","state":"done"}',
  ]);
  assert.deepEqual(reader.read_the_rest(), ['{"st']);
  assert.deepEqual(reader.read_the_rest(), []);
});

test('a line that is not a progress line is nothing', () => {
  assert.equal(parse_progress_line('Setting up docker-ce (5:27.0.1) ...'), null);
  assert.equal(parse_progress_line('{"step":"tools"'), null);
  assert.equal(parse_progress_line('"tools"'), null);
  assert.equal(parse_progress_line('null'), null);
  assert.equal(parse_progress_line('{"step":"tools"}'), null);
  assert.deepEqual(parse_progress_line('{"step":"tools","state":"done"}'), line('tools', 'done'));
});

test('a run that ends with the last step done, and exit code 0, is done', () => {
  const outcome = read_run_outcome({ lines: [line('tools', 'started'), install_done], exit_code: 0, last_step: 'install' });
  assert.equal(outcome.kind, 'done');
  assert.equal(outcome.address, 'https://a.example.com');
  assert.equal(outcome.install_dir, '/opt/alfera/source/deploy');
});

test('a failed line gives its reason and its sentence, also for a reason nobody knows', () => {
  const failed = line('start', 'failed', { reason: 'a_new_reason', message: 'One sentence.' });
  assert.deepEqual(read_run_outcome({ lines: [line('start', 'started'), failed], exit_code: 1, last_step: 'install' }), {
    kind: 'failed',
    reason: 'a_new_reason',
    message: 'One sentence.',
  });
  assert.deepEqual(read_run_outcome({ lines: [line('start', 'failed')], exit_code: 1, last_step: 'install' }), {
    kind: 'failed',
    reason: 'unlisted',
    message: '',
  });
});

test('a run that ends with no last line says how it ended', () => {
  const some = [line('tools', 'started'), line('tools', 'done')];
  const kind_of = (lines, exit_code) => read_run_outcome({ lines, exit_code, last_step: 'install' }).kind;
  assert.equal(kind_of(some, 255), 'connection_lost');
  assert.equal(kind_of([], 255), 'connection_lost');
  assert.equal(kind_of(some, null), 'connection_lost');
  assert.equal(kind_of([], 22), 'did_not_start');
  assert.equal(kind_of([], 0), 'did_not_start');
  assert.equal(kind_of(some, 1), 'stopped');
  assert.equal(kind_of(some, 0), 'stopped');
  assert.equal(kind_of([install_done], 1), 'stopped');
});

test('the rows before the step under way are done, and the rows after it wait', () => {
  const lines = [line('tools', 'started'), line('tools', 'done'), line('docker', 'started'), line('docker', 'done'), line('source', 'started')];
  assert.deepEqual(read_row_states(progress_rows, lines), ['done', 'done', 'working', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting']);
  assert.deepEqual(read_row_states(progress_rows, []), Array(8).fill('waiting'));
});

test('a row that covers two steps stays under way between them', () => {
  const lines = [line('api_image', 'started'), line('api_image', 'done')];
  assert.equal(read_row_states(progress_rows, lines)[4], 'working');
  assert.equal(read_row_states(progress_rows, [...lines, line('start', 'started')])[4], 'done');
});

test('lines that come again, from the first one, move no row back', () => {
  const before_the_cut = [line('tools', 'started'), line('tools', 'done'), line('docker', 'started'), line('docker', 'done'), line('source', 'started')];
  const shown_before = read_row_states(progress_rows, before_the_cut);
  const comes_again = [line('tools', 'started'), line('tools', 'done'), line('docker', 'started')];
  for (let count = 1; count <= comes_again.length; count += 1) {
    assert.deepEqual(read_row_states(progress_rows, [...before_the_cut, ...comes_again.slice(0, count)]), shown_before);
  }
  const goes_on = [...before_the_cut, ...comes_again, line('docker', 'done'), line('source', 'started'), line('source', 'done'), line('settings', 'started')];
  assert.deepEqual(read_row_states(progress_rows, goes_on).slice(0, 4), ['done', 'done', 'done', 'working']);
});

test('a step this app does not know moves no row', () => {
  const lines = [line('tools', 'started'), line('a_step_from_a_newer_installer', 'started')];
  assert.deepEqual(read_row_states(progress_rows, lines).slice(0, 2), ['working', 'waiting']);
});

test('the row that stopped is marked', () => {
  const stopped = [line('tools', 'done'), line('docker', 'started'), line('docker', 'failed', { reason: 'docker_install_failed' })];
  assert.deepEqual(read_row_states(progress_rows, stopped).slice(0, 3), ['done', 'failed', 'waiting']);
});

test('no row is done that the installer did not say was done', () => {
  // A stream that jumps ahead: the rows it skipped are not done, they wait.
  const jumps = [line('tools', 'started'), line('start', 'started')];
  assert.deepEqual(read_row_states(progress_rows, jumps), ['working', 'waiting', 'waiting', 'waiting', 'waiting', 'working', 'waiting', 'waiting']);
  // An install that was up already: only the steps it ran again are done.
  const up_already = [...['tools', 'docker', 'source'].flatMap((step) => [line(step, 'started'), line(step, 'done')]), install_done];
  assert.deepEqual(read_row_states(progress_rows, up_already), ['done', 'done', 'done', 'waiting', 'waiting', 'waiting', 'waiting', 'waiting']);
  // The last line alone marks nothing done.
  assert.deepEqual(read_row_states(progress_rows, [install_done]), Array(8).fill('waiting'));
});

test('a stream that ends where the build of the first image starts shows the build under way, and nothing after it', () => {
  const steps_before = ['tools', 'docker', 'source', 'settings'].flatMap((step) => [line(step, 'started'), line(step, 'done')]);
  const cut = [...steps_before, line('api_image', 'started')];
  assert.deepEqual(read_row_states(progress_rows, cut), ['done', 'done', 'done', 'done', 'working', 'waiting', 'waiting', 'waiting']);
});

test('the last row is done when its step is done, and a row with two steps when the install is done', () => {
  const all = ['tools', 'docker', 'source', 'settings', 'api_image', 'app_image', 'start', 'api', 'dashboard', 'https'].flatMap((step) => [line(step, 'started'), line(step, 'done')]);
  assert.deepEqual(read_row_states(progress_rows, all), Array(8).fill('done'));
  const without_https = all.slice(0, -2);
  assert.equal(read_row_states(progress_rows, without_https)[6], 'working');
  assert.equal(read_row_states(progress_rows, [...without_https, install_done])[6], 'done');
});

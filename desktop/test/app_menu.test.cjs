const assert = require('node:assert/strict');
const { test } = require('node:test');
const { read_app_menu } = require('../src/app_menu.cjs');

// Every row with something to do, from every menu. A row with a role is done by macOS itself.
function rows_of_the_app({ tabs_are_in_use, offers_folder_work = true }) {
  const done = [];
  const actions = new Proxy({}, { get: (_actions, name) => (...inputs) => done.push([name, ...inputs]) });
  const menus = read_app_menu({ tabs_are_in_use, offers_folder_work, actions });
  const rows = menus.flatMap((menu) => menu.submenu ?? []).filter((row) => row.click);
  return { rows, done };
}
const rows_a_person_can_choose = (rows) => rows.filter((row) => row.enabled !== false).map((row) => row.label);

test('on the first run and while the setup shows, the only row to choose is the one that changes the address', () => {
  const { rows } = rows_of_the_app({ tabs_are_in_use: false });
  assert.deepEqual(rows_a_person_can_choose(rows), ['Change Address…']);
});

test('a row that cannot be chosen keeps its shortcut from doing anything: it is not enabled', () => {
  const { rows } = rows_of_the_app({ tabs_are_in_use: false });
  const with_a_shortcut = rows.filter((row) => row.accelerator);
  assert.equal(with_a_shortcut.length, 19);
  assert.ok(with_a_shortcut.every((row) => row.enabled === false));
});

test('with the tabs in use, every row can be chosen and does its own thing', () => {
  const { rows, done } = rows_of_the_app({ tabs_are_in_use: true });
  assert.ok(rows.every((row) => row.enabled !== false));
  for (const row of rows) row.click();
  assert.deepEqual(done.map(([name]) => name).slice(0, 6), ['change_address', 'work_in_a_folder', 'stop_working_in_the_folder', 'open_new_tab', 'close_tab', 'ask_alfera']);
  assert.deepEqual(done.filter(([name]) => name === 'show_tab_at').map(([, index]) => index), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('work in a folder is offered only where the server has it, and only with the tabs in use', () => {
  const has_folder_rows = (state) => rows_of_the_app(state).rows.some((row) => row.label === 'Work in a Folder…');
  assert.equal(has_folder_rows({ tabs_are_in_use: true, offers_folder_work: true }), true);
  assert.equal(has_folder_rows({ tabs_are_in_use: true, offers_folder_work: false }), false);
  assert.equal(has_folder_rows({ tabs_are_in_use: false, offers_folder_work: true }), false);
});

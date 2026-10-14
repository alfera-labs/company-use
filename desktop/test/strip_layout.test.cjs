const assert = require('node:assert/strict');
const { test } = require('node:test');
const { read_strip_layout } = require('../src/window/strip_layout.js');

const at = (changes) => read_strip_layout({ window_width: 1512, sidebar_width: 248, is_full_screen: false, tab_count: 7, ...changes });

test('the layout is told by the window, the sidebar and the number of tabs: a name is not asked for', () => {
  assert.deepEqual(Object.keys(at({})).sort(), ['band_width', 'row_scrolls', 'row_width', 'tab_width', 'tabs_left']);
  assert.deepEqual(at({}), at({}));
});

test('few tabs are as wide as a tab gets, and one more tab moves the button by one tab', () => {
  assert.equal(at({ tab_count: 1 }).tab_width, 190);
  assert.equal(at({ tab_count: 3 }).tab_width, 190);
  assert.equal(at({ tab_count: 3 }).row_width - at({ tab_count: 2 }).row_width, 192);
});

test('more tabs share the room evenly, down to a width that still shows a few words', () => {
  const seven = at({ tab_count: 7 });
  assert.equal(seven.tab_width, Math.floor((1512 - 256 - 36 - 12 - 12) / 7));
  assert.equal(seven.row_scrolls, false);
  const twenty = at({ tab_count: 20, window_width: 1024 });
  assert.equal(twenty.tab_width, 128);
  assert.equal(twenty.row_scrolls, true);
  assert.ok(twenty.tabs_left + twenty.row_width + 36 + 12 <= 1024, 'the new tab button is clear of the window edge');
});

test('the band is as wide as the sidebar, and the tabs start at its edge', () => {
  assert.deepEqual([at({}).band_width, at({}).tabs_left], [248, 256]);
});

test('a sidebar narrower than the window buttons gets no band, and the tabs keep clear of the buttons', () => {
  const folded = at({ sidebar_width: 56 });
  assert.deepEqual([folded.band_width, folded.tabs_left], [0, 92]);
  const none = at({ sidebar_width: 0 });
  assert.deepEqual([none.band_width, none.tabs_left], [0, 92]);
});

test('in full screen there are no window buttons, so a folded sidebar has its band', () => {
  const folded = at({ sidebar_width: 56, is_full_screen: true });
  assert.deepEqual([folded.band_width, folded.tabs_left], [56, 64]);
  assert.deepEqual([at({ sidebar_width: 0, is_full_screen: true }).tabs_left], [8]);
});

test('no tab at all is a row of no width', () => {
  assert.equal(at({ tab_count: 0 }).row_width, 0);
});

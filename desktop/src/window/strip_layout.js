// Where everything in the tab strip is. It is worked out from four numbers and from nothing
// else, so no name of a tab can move a tab: a row of tabs changes only when a tab comes or goes,
// when the sidebar moves, or when the window changes.
// This file runs in the strip and in the tests.
const width_of_the_window_buttons = 84;
const widest_tab = 190;
const narrowest_tab = 128;
const gap_between_tabs = 2;
const gap_before_the_tabs = 8;
const room_for_the_new_tab_button = 36;
const gap_at_the_right_edge = 12;

// The band over the sidebar is exactly as wide as the sidebar, and has its colour. A sidebar
// that is narrower than the window buttons gets no band: the buttons would sit half on it.
// The tabs start at the right edge of the band, or right of the window buttons.
function read_strip_layout({ window_width, sidebar_width, is_full_screen, tab_count }) {
  const window_buttons = is_full_screen ? 0 : width_of_the_window_buttons;
  const band_width = sidebar_width >= window_buttons ? sidebar_width : 0;
  const tabs_left = Math.max(band_width, window_buttons) + gap_before_the_tabs;
  const room = window_width - tabs_left - room_for_the_new_tab_button - gap_at_the_right_edge;
  const count = Math.max(tab_count, 1);
  const even_share = Math.floor((room - gap_between_tabs * (count - 1)) / count);
  const tab_width = Math.max(narrowest_tab, Math.min(widest_tab, even_share));
  const width_of_all_tabs = tab_count * tab_width + gap_between_tabs * Math.max(tab_count - 1, 0);
  const row_scrolls = width_of_all_tabs > room;
  return {
    band_width,
    tabs_left,
    tab_width,
    row_width: Math.max(0, Math.min(width_of_all_tabs, room)),
    row_scrolls,
  };
}

if (typeof module !== 'undefined') module.exports = { read_strip_layout };

// The page of the tab strip. It draws what the app tells it: the tabs, the look of the page in
// front, and whether a screen of the app itself covers the tabs.
const row = document.getElementById('tabs');
const root_style = document.documentElement.style;
const elements_by_id = new Map();
const names_of_the_look = ['--page', '--sidebar', '--text', '--sidebar-edge', '--dim-color', '--dim-share'];
let sidebar_width = 0;
let is_full_screen = false;

function create_tab_element(tab) {
  const element = document.createElement('div');
  element.className = 'tab';
  element.innerHTML = '<span class="state"><i class="w"></i><i class="n"></i><i class="d"><svg viewBox="0 0 14 14"><path d="M3 7.500l2.700 2.700L11 4.500"/></svg></i></span><span class="name"></span><span class="close"><svg viewBox="0 0 12 12"><path d="M2.500 2.500l7 7M9.500 2.500l-7 7"/></svg></span>';
  element.addEventListener('mousedown', (event) => { if (event.button === 0 && !event.target.closest('.close')) alfera_tabs.select(tab.id); });
  element.querySelector('.close').addEventListener('click', () => alfera_tabs.close(tab.id));
  element.addEventListener('auxclick', (event) => { if (event.button === 1) alfera_tabs.close(tab.id); });
  return element;
}

// Elements are kept and updated, never rebuilt: a rebuilt element restarts its spinner and
// loses the move from "working" to "needs you".
function show_tabs(tabs) {
  for (const [id, element] of elements_by_id) {
    if (!tabs.some((tab) => tab.id === id)) { element.remove(); elements_by_id.delete(id); }
  }
  tabs.forEach((tab, place) => {
    const element = elements_by_id.get(tab.id) ?? create_tab_element(tab);
    elements_by_id.set(tab.id, element);
    element.classList.toggle('front', tab.in_front);
    element.title = tab.title;
    element.querySelector('.name').textContent = tab.title;
    const state = tab.state ?? (tab.is_loading ? 'loading' : null);
    const mark = element.querySelector('.state');
    if (state) mark.dataset.state = state; else delete mark.dataset.state;
    if (row.children[place] !== element) row.insertBefore(element, row.children[place] ?? null);
  });
}

function lay_out_the_strip() {
  const layout = read_strip_layout({ window_width: innerWidth, sidebar_width, is_full_screen, tab_count: elements_by_id.size });
  root_style.setProperty('--band-width', `${layout.band_width}px`);
  root_style.setProperty('--tabs-left', `${layout.tabs_left}px`);
  root_style.setProperty('--tab-width', `${layout.tab_width}px`);
  root_style.setProperty('--row-width', `${layout.row_width}px`);
  keep_the_front_tab_in_view();
}

// The tab in front is never out of sight, however many tabs there are and whatever the width.
function keep_the_front_tab_in_view() {
  row.querySelector('.tab.front')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  show_where_more_tabs_are();
}

function show_where_more_tabs_are() {
  row.classList.toggle('more-left', row.scrollLeft > 1);
  row.classList.toggle('more-right', row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
}

// A page that has no solid colour of its own (an error page of the server) gives no colours,
// and the strip keeps the ones it has.
function show_look(look) {
  if (look.strip_color) {
    root_style.setProperty('--page', look.strip_color);
    root_style.setProperty('--sidebar', look.sidebar_color ?? look.strip_color);
    root_style.setProperty('--text', look.text_color);
    root_style.setProperty('--sidebar-edge', look.sidebar_edge_color ?? 'transparent');
  }
  root_style.setProperty('--dim-color', look.dimmed_by?.color ?? 'transparent');
  root_style.setProperty('--dim-share', look.dimmed_by?.share_shown ?? 0);
  sidebar_width = look.sidebar_width ?? 0;
  lay_out_the_strip();
}

// A page of the app itself covers the tabs: the strip is bare, in the colours of that page.
function show_covered(is_covered) {
  document.body.classList.toggle('covered', is_covered);
  if (is_covered) for (const name of names_of_the_look) root_style.removeProperty(name);
}

alfera_tabs.on_change((tabs) => {
  show_tabs(tabs);
  lay_out_the_strip();
});
alfera_tabs.on_look(show_look);
alfera_tabs.on_covered(show_covered);
alfera_tabs.on_full_screen((now) => {
  is_full_screen = now;
  lay_out_the_strip();
});
addEventListener('resize', lay_out_the_strip);
row.addEventListener('scroll', show_where_more_tabs_are);
document.getElementById('new').addEventListener('click', alfera_tabs.open_new);
lay_out_the_strip();

const { ipcRenderer, webFrame } = require('electron');

// Runs inside every page of a tab. It does what the page cannot do for itself: it opens a link
// in a new tab when the person asks for one, and it tells the app what the page looks like so
// the tab strip can match it (colours, sidebar, a dimmed page, an answer under way).

// A plain click stays in its tab, as in any app. A click with the Command key opens a new tab.
function open_link_in_a_new_tab_when_asked(event) {
  if (event.defaultPrevented || event.button !== 0 || !event.metaKey) return;
  const link = event.target.closest?.('a[href]');
  if (!link) return;
  const target = new URL(link.href, location.href);
  if (target.origin !== location.origin) return;
  event.preventDefault();
  event.stopPropagation();
  ipcRenderer.send('tabs:open_in_new_tab', target.href);
}

// The sidebar is found in the document, never by asking what is under a point: while a menu, a
// dialog or a sheet is open, the page takes the pointer away from everything else, and a point
// then answers with the overlay or with nothing. The web app names its sidebar; a page that does
// not gets the plain reading: a tall, narrow block at the left edge.
const sidebar_of_the_web_app = '[data-slot="sidebar"]';
const blocks_that_can_be_a_sidebar = 'aside, nav';
const widest_share_of_the_window = 0.45;
const least_share_of_the_height = 0.6;
const stop_button_of_an_answer = '[aria-label="Stop response"]';

function is_a_column_at_the_left_edge(element) {
  const box = element.getBoundingClientRect();
  return (
    box.left <= 1 &&
    box.width > 0 &&
    box.right < innerWidth * widest_share_of_the_window &&
    box.height > innerHeight * least_share_of_the_height
  );
}

function find_sidebar() {
  const named = document.querySelector(sidebar_of_the_web_app);
  const candidates = named ? [named] : [...document.querySelectorAll(blocks_that_can_be_a_sidebar)];
  return candidates.find(is_a_column_at_the_left_edge) ?? null;
}

// In a narrow window the web app turns its sidebar into a bar across the top. The strip then
// sits on that bar, and takes its colour.
function find_bar_across_the_top() {
  const named = document.querySelector(sidebar_of_the_web_app);
  if (!named) return null;
  const box = named.getBoundingClientRect();
  return box.top <= 1 && box.left <= 1 && box.width >= innerWidth - 1 ? named : null;
}

// How much of a colour is there: 1 for a solid colour, 0 for none. The browser writes a colour
// in the notation the page used: rgb(1, 2, 3), rgba(1, 2, 3, 0.5), oklch(0.2 0.01 285),
// oklch(0.2 0.01 285 / 0.5). The number after a slash, or the fourth of an rgba, says how much.
function read_share_of_color(color) {
  if (!color || color === 'transparent') return 0;
  const after_slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(color);
  if (after_slash) return Number(after_slash[1]) / (after_slash[2] ? 100 : 1);
  const fourth_of_rgba = /^rgba\((?:[^,]+,){3}\s*([\d.]+)\s*\)$/.exec(color);
  return fourth_of_rgba ? Number(fourth_of_rgba[1]) : 1;
}

// A colour counts when nothing shows through it. A page with no solid colour gives none, and
// the strip keeps the colours it has.
function first_solid_background(element) {
  for (let current = element; current; current = current.parentElement) {
    const color = getComputedStyle(current).backgroundColor;
    if (read_share_of_color(color) >= 1) return color;
  }
  return null;
}

// A dialog, a sheet and the search lay a see-through layer over the whole page. The strip is
// not part of the page, so it is told the colour of that layer and lays the same one over itself.
// The layer is a block that is fixed over the whole window, one to three levels under the body.
function find_layer_that_dims_the_page() {
  const near_the_body = [...document.body.querySelectorAll(':scope > *, :scope > * > *, :scope > * > * > *')];
  for (const block of near_the_body) {
    const style = getComputedStyle(block);
    if (style.position !== 'fixed' || style.visibility === 'hidden' || style.display === 'none') continue;
    const share = read_share_of_color(style.backgroundColor) * Number(style.opacity);
    if (share <= 0 || read_share_of_color(style.backgroundColor) >= 1) continue;
    const box = block.getBoundingClientRect();
    const covers_the_window = box.left <= 0 && box.top <= 0 && box.right >= innerWidth && box.bottom >= innerHeight;
    if (covers_the_window) return { color: style.backgroundColor, share_shown: Number(style.opacity) };
  }
  return null;
}

// The part of the page beside the sidebar. Its colour is the colour the tabs sit on.
function find_content(sidebar) {
  return sidebar?.nextElementSibling ?? document.querySelector('main') ?? document.body;
}

// Widths are told as they are on the screen: a page the person zoomed is wider than it thinks.
function read_look() {
  const sidebar = find_sidebar();
  const bar = sidebar ? null : find_bar_across_the_top();
  const page_color = first_solid_background(find_content(sidebar));
  return {
    sidebar_width: sidebar ? Math.round(sidebar.getBoundingClientRect().right * webFrame.getZoomFactor()) : 0,
    sidebar_color: sidebar ? first_solid_background(sidebar) : null,
    sidebar_edge_color: sidebar ? getComputedStyle(sidebar).borderRightColor : null,
    page_color,
    strip_color: bar ? first_solid_background(bar) : page_color,
    text_color: getComputedStyle(document.body).color,
    dimmed_by: find_layer_that_dims_the_page(),
    is_answering: Boolean(document.querySelector(stop_button_of_an_answer)),
  };
}

let last_look = '';
function tell_the_app_how_the_page_looks() {
  if (!document.body) return;
  const look = JSON.stringify(read_look());
  if (look === last_look) return;
  last_look = look;
  ipcRenderer.send('page:look', JSON.parse(look));
}

// A layer that dims the page fades in over a moment. The page is looked at a few times while it
// does, so the strip dims with it and not half a second later.
const moments_to_look_again_ms = [0, 60, 150, 320];
function look_again_soon() {
  for (const moment of moments_to_look_again_ms) setTimeout(tell_the_app_how_the_page_looks, moment);
}

// While the sidebar folds or is dragged wider, its width changes on every frame, and the strip
// follows on every frame. The slow look catches what has no event: a new theme, a new page.
let watched_sidebar = null;
const sidebar_watcher = new ResizeObserver(tell_the_app_how_the_page_looks);
function watch_the_sidebar() {
  const sidebar = find_sidebar() ?? document.querySelector(sidebar_of_the_web_app);
  if (sidebar === watched_sidebar) return;
  sidebar_watcher.disconnect();
  watched_sidebar = sidebar;
  if (sidebar) sidebar_watcher.observe(sidebar);
}

let watches_the_body = false;
function watch_what_is_laid_over_the_page() {
  if (watches_the_body || !document.body) return;
  watches_the_body = true;
  new MutationObserver(look_again_soon).observe(document.body, { childList: true });
}

// The app's own "cannot be reached" page asks for a new try with this event. The page does not
// know the address it stands in for; the app does.
document.addEventListener('alfera:try_again', () => {
  if (location.protocol === 'file:') ipcRenderer.send('tabs:try_again');
});
document.addEventListener('click', open_link_in_a_new_tab_when_asked, true);
// The strip learns the look of a page as soon as the page has one, not at the next slow look:
// a tab whose name arrives first would sit in the wrong place for a moment.
document.addEventListener('DOMContentLoaded', look_again_soon);
addEventListener('load', look_again_soon);
addEventListener('resize', tell_the_app_how_the_page_looks);
setInterval(() => {
  watch_the_sidebar();
  watch_what_is_laid_over_the_page();
  tell_the_app_how_the_page_looks();
}, 500);

const { Menu, Tray, app, nativeImage } = require('electron');
const { is_invisible } = require('./invisible_run.cjs');
const { sessions_in_state } = require('./sessions.cjs');

// The Alfera mark as two shapes on a 1024 grid, the same shapes as the app icon.
const mark_shapes = [
  [
    [512, 120],
    [408, 300],
    [716, 836],
    [920, 836],
  ],
  [
    [290, 507],
    [495, 508],
    [307, 836],
    [103, 836],
  ],
];
const icon_pixels = 36;
const samples_per_pixel_side = 4;

function is_inside(shape, x, y) {
  let inside = false;
  for (let i = 0, j = shape.length - 1; i < shape.length; j = i++) {
    const [xi, yi] = shape[i];
    const [xj, yj] = shape[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// macOS colours a menu bar icon itself (dark in a light bar, light in a dark one) when the image
// is only black with transparency. Drawing it here keeps a binary file out of the app.
function draw_mark() {
  const pixels = Buffer.alloc(icon_pixels * icon_pixels * 4);
  const grid_per_sample = 1024 / (icon_pixels * samples_per_pixel_side);
  for (let y = 0; y < icon_pixels; y += 1) {
    for (let x = 0; x < icon_pixels; x += 1) {
      let covered = 0;
      for (let sy = 0; sy < samples_per_pixel_side; sy += 1) {
        for (let sx = 0; sx < samples_per_pixel_side; sx += 1) {
          const gx = (x * samples_per_pixel_side + sx + 0.5) * grid_per_sample;
          const gy = (y * samples_per_pixel_side + sy + 0.5) * grid_per_sample;
          if (mark_shapes.some((shape) => is_inside(shape, gx, gy))) covered += 1;
        }
      }
      pixels[(y * icon_pixels + x) * 4 + 3] = Math.round(
        (covered / samples_per_pixel_side ** 2) * 255,
      );
    }
  }
  const image = nativeImage.createFromBitmap(pixels, {
    width: icon_pixels,
    height: icon_pixels,
    scaleFactor: 2,
  });
  image.setTemplateImage(true);
  return image;
}

const most_letters_of_a_title = 60;
const words_for_chats_that_need_you = (count) => (count === 1 ? '1 chat needs you' : `${count} chats need you`);

// What the icon shows for the chats of the person: the number beside it, the words under the
// pointer, and the rows of its list. The shortcut is shown only when macOS gave it to this app.
function read_menu_bar_list({ sessions, quick_ask_shortcut, actions }) {
  const needs_you = sessions_in_state(sessions, 'needs_you');
  const working = sessions_in_state(sessions, 'working');
  const chat_rows = (chats) =>
    chats.length > 0
      ? chats.map((chat) => ({
          label: chat.title.slice(0, most_letters_of_a_title),
          click: () => actions.open_chat(chat.session_id),
        }))
      : [{ label: 'Nothing', enabled: false }];
  return {
    number: needs_you.length > 0 ? String(needs_you.length) : '',
    words_under_the_pointer: needs_you.length > 0 ? words_for_chats_that_need_you(needs_you.length) : 'Alfera',
    rows: [
      { label: 'Needs you', enabled: false },
      ...chat_rows(needs_you),
      { type: 'separator' },
      { label: 'Working', enabled: false },
      ...chat_rows(working),
      { type: 'separator' },
      {
        label: 'Ask Alfera…',
        ...(quick_ask_shortcut ? { accelerator: quick_ask_shortcut } : {}),
        click: actions.open_quick_ask,
      },
      { label: 'Open Alfera', click: actions.show_window },
      { type: 'separator' },
      { role: 'quit' },
    ],
  };
}

// An invisible run has no icon in the menu bar and no number on the Dock.
function create_menu_bar_icon({ open_chat, open_quick_ask, show_window, quick_ask_shortcut }) {
  if (is_invisible) return { show_sessions: () => {} };
  const tray = new Tray(draw_mark());

  function show_sessions(sessions) {
    const list = read_menu_bar_list({
      sessions,
      quick_ask_shortcut,
      actions: { open_chat, open_quick_ask, show_window },
    });
    tray.setTitle(list.number ? ` ${list.number}` : '');
    app.dock?.setBadge(list.number);
    tray.setToolTip(list.words_under_the_pointer);
    tray.setContextMenu(Menu.buildFromTemplate(list.rows));
  }

  show_sessions({});
  return { show_sessions };
}

module.exports = { create_menu_bar_icon, draw_mark, read_menu_bar_list };

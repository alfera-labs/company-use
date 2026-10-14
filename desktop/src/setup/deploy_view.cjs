const { WebContentsView } = require('electron');
const { open_outside_the_app, take_the_keyboard } = require('../invisible_run.cjs');
const { parse_web_address } = require('../settings.cjs');
const { read_deploy_page_address, read_new_server_choice, stays_in_the_deploy_page } = require('./deploy_page.cjs');

const color_of_the_deploy_page = '#fafaf8';
const errno_of_a_load_another_navigation_replaced = -3;

function open_outside_when_it_is_a_web_address(target) {
  if (parse_web_address(target)) open_outside_the_app(target);
}

function keep_the_deploy_page_in_its_lane(contents, deploy_page_address, { on_new_server, on_leave }) {
  contents.on('will-navigate', (event, target) => {
    const choice = read_new_server_choice(target, contents.getURL(), deploy_page_address);
    if (stays_in_the_deploy_page(target, deploy_page_address) && !choice) return;
    event.preventDefault();
    if (choice) on_new_server(choice);
    else open_outside_when_it_is_a_web_address(target);
  });
  contents.setWindowOpenHandler(({ url }) => {
    open_outside_when_it_is_a_web_address(url);
    return { action: 'deny' };
  });
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'Escape') return;
    event.preventDefault();
    on_leave();
  });
}

function open_deploy_view({ over, on_new_server, on_leave }) {
  const deploy_page_address = read_deploy_page_address();
  const view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const contents = view.webContents;
  const fit = () => view.setBounds({ ...over.getBounds(), x: 0, y: 0 });
  let settle_the_load = () => {};
  const loaded = new Promise((resolve) => (settle_the_load = resolve));
  let is_open = true;

  function close() {
    if (!is_open) return;
    is_open = false;
    settle_the_load(true);
    over.off('bounds-changed', fit);
    over.removeChildView(view);
    if (!contents.isDestroyed()) contents.close();
  }

  keep_the_deploy_page_in_its_lane(contents, deploy_page_address, {
    on_new_server: (choice) => (close(), on_new_server(choice)),
    on_leave: () => (close(), on_leave()),
  });
  view.setBackgroundColor(color_of_the_deploy_page);
  over.addChildView(view);
  fit();
  over.on('bounds-changed', fit);
  contents.loadURL(deploy_page_address).then(
    () => settle_the_load(true),
    (error) => settle_the_load(error.errno === errno_of_a_load_another_navigation_replaced),
  );
  take_the_keyboard(contents);
  return { close, loaded };
}

module.exports = { open_deploy_view };

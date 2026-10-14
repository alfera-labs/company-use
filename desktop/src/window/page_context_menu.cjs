const { Menu } = require('electron');
const { clipboard, pop_up } = require('../invisible_run.cjs');

// Electron shows no menu on a right click by default, so copy and paste by mouse would not exist.
function show_context_menu_on(contents, open_in_a_new_tab) {
  contents.on('context-menu', (_event, clicked) => {
    const rows = [
      clicked.linkURL && {
        label: 'Open Link in New Tab',
        click: () => open_in_a_new_tab(clicked.linkURL),
      },
      clicked.linkURL && { label: 'Copy Link', click: () => clipboard().writeText(clicked.linkURL) },
      clicked.linkURL && { type: 'separator' },
      clicked.isEditable && { role: 'cut' },
      (clicked.isEditable || clicked.selectionText) && { role: 'copy' },
      clicked.isEditable && { role: 'paste' },
      clicked.isEditable && { role: 'selectAll' },
    ].filter(Boolean);
    const ends_with_a_line = rows.at(-1)?.type === 'separator';
    if (ends_with_a_line) rows.pop();
    if (rows.length > 0) pop_up(Menu.buildFromTemplate(rows));
  });
}

module.exports = { show_context_menu_on };

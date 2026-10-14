// The menus of the app, as plain rows. `actions` holds what each row does. A row that belongs
// to the tabs can be chosen only while the tabs are in use: not on the first run, and not while
// the setup shows. A row that cannot be chosen has no shortcut either.
// This file knows nothing of Electron, so a test can read every row.
const numbers_of_the_tabs = [1, 2, 3, 4, 5, 6, 7, 8, 9];

function read_app_menu({ tabs_are_in_use, offers_folder_work, actions }) {
  const for_the_tabs = (row) => ({ ...row, enabled: tabs_are_in_use });
  const folder_work_rows = offers_folder_work && tabs_are_in_use
    ? [
        { label: 'Work in a Folder…', click: actions.work_in_a_folder },
        { label: 'Stop Working in the Folder', click: actions.stop_working_in_the_folder },
        { type: 'separator' },
      ]
    : [];
  const show_tab_number = (number) =>
    for_the_tabs({
      label: `Tab ${number}`,
      accelerator: `Cmd+${number}`,
      visible: false,
      click: () => actions.show_tab_at(number - 1),
    });
  return [
    {
      label: 'Alfera',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { label: 'Change Address…', click: actions.change_address },
        { type: 'separator' },
        ...folder_work_rows,
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        for_the_tabs({ label: 'New Tab', accelerator: 'Cmd+T', click: actions.open_new_tab }),
        for_the_tabs({ label: 'Close Tab', accelerator: 'Cmd+W', click: actions.close_tab }),
        { type: 'separator' },
        for_the_tabs({ label: 'Ask Alfera…', click: actions.ask_alfera }),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        for_the_tabs({ label: 'Reload', accelerator: 'Cmd+R', click: actions.reload }),
        for_the_tabs({ label: 'Back', accelerator: 'Cmd+[', click: actions.go_back }),
        for_the_tabs({ label: 'Forward', accelerator: 'Cmd+]', click: actions.go_forward }),
        { type: 'separator' },
        { role: 'togglefullscreen' },
        for_the_tabs({ label: 'Actual Size', accelerator: 'Cmd+0', click: actions.show_actual_size }),
        for_the_tabs({ label: 'Zoom In', accelerator: 'Cmd+Plus', click: actions.zoom_in }),
        for_the_tabs({ label: 'Zoom Out', accelerator: 'Cmd+-', click: actions.zoom_out }),
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { type: 'separator' },
        for_the_tabs({ label: 'Show Next Tab', accelerator: 'Cmd+Shift+]', click: actions.show_next_tab }),
        for_the_tabs({ label: 'Show Previous Tab', accelerator: 'Cmd+Shift+[', click: actions.show_previous_tab }),
        ...numbers_of_the_tabs.map(show_tab_number),
      ],
    },
  ];
}

module.exports = { read_app_menu };

# Alfera desktop

Alfera as a Mac app. It is a window on Alfera Cloud, or on your own Alfera server. It adds what
a browser tab cannot: tabs that show what each chat is doing, a menu bar icon, and a quick-ask
bar that opens from any app.

## Build it from source

Three commands, about two minutes. You need a Mac and Node 24 or newer. It works on Apple
Silicon and on Intel: the build is made for the Mac it runs on.

```bash
cd desktop
npm install
npm run install-app
```

`npm run install-app` builds the app, puts it in `/Applications/Alfera.app` (it replaces an older
copy of itself), and opens it. The build prints `THIS BUILD IS UNSIGNED`: that is correct for a
build you make for your own Mac, and macOS opens it without a warning because it was built
there. To make a download for other people, read [RELEASING.md](RELEASING.md).

## The first run

The app opens in its own full window and asks one question: where is your Alfera?

- **Alfera Cloud**, the first choice and the one filled button. The sign-in page of
  `https://app.alfera.ai` opens.
- **Set up my own server.** The window shows the same one-click page as the web app
  (`https://app.alfera.ai/deploy`). You pick DigitalOcean or AWS there. See the next part.
  Under the row is a quiet link, **I will do it myself**: the guided setup over SSH, later in
  this file. Before the first screen offers that link, the app asks once whether the installer
  can be downloaded. When it cannot, the link does not show.
- **I already have an Alfera server**, a quiet link under the two. Paste the address of your
  server (`alfera.example.com` is enough), or the sign-in link its owner gave you
  (`<address>/join/...`). The app checks that an Alfera server answers there before it saves the
  address. If not, it says in one sentence what is wrong: nothing answers there, or something
  answers that is not Alfera.

Each screen fades into the next. The keyboard is on the main button, Return presses it, Escape
goes one screen back. When you have chosen, the same window becomes the app. Until then, and
while these screens show, nothing else in the app does anything: every menu row that belongs to
the tabs is grey, and so is its shortcut.

**A server that signs people in with a link.** Such a server shows a page with nothing to press,
and the app has no address bar. So the app shows a screen of its own over it: one field, "Paste
your sign-in link", one sentence that says where a link comes from, and "Back". The link opens
in the app. The same screen comes when a link is used up or not valid, and says so. When this
app set the server up, the screen has one more button, "Get a new sign-in link from my server":
the app asks the server for it with the SSH key it already has. A sign-in link is never shown
and never written down.

To change the answer later: in the menu bar, Alfera, then "Change Address…". The same screens
come up over the app, and Escape leaves them. While the screens are open, "Change Address…" goes
to the first one: that is the way out of every screen.

Then check that the rest works:

1. Press ⌥ Space in any app: the quick-ask bar opens. If nothing happens, another app holds that
   shortcut.
2. Look for the Alfera mark in the menu bar.

## The one-click page

"Set it up" opens the deploy page of Alfera Cloud over the first screen, in the same window.

- The DigitalOcean sign-in stays in the window, and so does the way back to the deploy page
  after "Authorize". The deploy page keeps the sign-in it started in the window, so the answer
  must come back to the same window. A sign-in to DigitalOcean with Google or GitHub stays in the window too.
- Every other link opens in your browser. The AWS console is one of them: it needs the sign-in
  you already have there.
- When the server is ready, the deploy page opens its setup page
  (`https://<address>/setup#token=…`). The app stops there, makes that server its address, and
  opens the setup page in a tab. The token is in no file: a tab saves the address of the server
  in its place.
- Escape closes the deploy page and goes back to the first screen. So does "Change Address…".
- When the deploy page does not load, the row says so in one sentence, and "Set it up" tries
  again.

The rules are in `src/setup/deploy_page.cjs`, and the page itself in `src/setup/deploy_view.cjs`.

## The guided setup of a server

You reach it with **I will do it myself** on the first screen.

Five screens, one thing each. You need a DigitalOcean account and an API key from Anthropic or
OpenAI. You need no terminal. The words on the screens have one name for each thing: "API key"
for that key, "SSH key" for the key of the app.

1. **What you need.**
2. **Make your server.** You press one button. DigitalOcean opens in your browser; you sign in
   and press "Authorize". The app makes a server there (Ubuntu 24.04, 2 CPU cores, 4 GB of
   memory, in the place nearest to the time zone of the Mac) with its own SSH key in it, waits
   until the server lets it in over SSH as root, and gives the access back. A second press uses
   the server it made before: a server carries a tag made from the key of the app and its size.
   A server that is off, or one the installer could not use, is not used again: "Make a new
   server" gets a new one. "Stop" (or Escape) ends the wait for DigitalOcean. If DigitalOcean
   makes no server, the screen gives its reason in one sentence, or its error code.

   The quiet link under the button is the way by hand, for any company: **Create your server**
   shows the public half of the app's key pair and the steps to click, and **The address of
   your server** takes the address, connects as root and checks that it is Ubuntu 24.04.
3. **Your API key.**
4. **Setting up.** The app runs the installer of this repository on the server
   (`deploy/install.sh`) and shows each of its steps. It usually takes 10 to 20 minutes. When
   the installer stops, the screen shows one sentence and one button: try again, make a new
   server, make a bigger server, or enter the API key again. The sentence is the installer's,
   or the app's own where the installer names a thing by another name than the app does. Under
   the button are "Back" (to the address) and "Start over" (to the first screen), and Escape
   goes back: no screen that stopped is a dead end. The install runs on the server by itself:
   when the connection drops, "Try again" shows the same install again, with the steps it
   already finished still done.
5. **Done.** The app asks the server for your sign-in link, opens it, and from then on opens
   your server. When the server got its name from its numbers and not from a domain of your
   own, this screen says so in one line: fine for trying it out, a domain for real use.

What the app keeps, and what it does not:

- The private half of the key pair is in `~/Library/Application Support/Alfera/server_setup/`,
  readable by you only. It is never shown. The file `known_hosts` beside it lists each server the
  app has met; when another server answers at the same address later, the app does not connect.
- The file `servers_set_up.json` beside them lists each server the app set up: its address, its
  host and the folder of the install. No secret is in it. It is what lets the app ask that server
  for a new sign-in link later.
- The API key goes to the installer on the server and nowhere else: it is in no argument, in no
  file on the Mac, and in no log. The app holds it in memory until the server has written it
  down, so a second try before that sends it again, and you type it once. After that, and when
  the installer refuses it or the window closes, the app drops it.
- The sign-in link goes to the tab that opens it. It is in no file and in no log.
- The DigitalOcean access is a token for one sign-in, asked for with PKCE and no secret of the
  app's own. It comes back to an address on this Mac only (`127.0.0.1`, a port the system
  picks), allows only what making one server takes, is held in memory, and is given back as
  soon as the server is made or the making stops.
- What the server says about itself is checked before it is used. The address must be `https` on
  the host the app connected to, or on the name the app asked for. The folder of the install
  must be a plain path. The sign-in link must be a link of that address. If not, nothing is
  opened, nothing is saved, and no command is sent with it.
- The log you can copy after a failure is plain text: codes for a terminal and bytes that are not
  text are taken out. No text from the server is ever drawn as HTML.
- The app starts the `ssh` and `ssh-keygen` of the Mac. It adds no SSH code of its own.

What the app and the installer agree on (the commands, the steps, the reasons a setup stops) is
in `src/setup/installer_contract.cjs`, and on the installer's side in `SELF_HOSTING.md` at the
root of the repository, under "Install from a program". The hosting company and its steps are one
record, `src/setup/setup_provider.js`. The address the installer is downloaded from is one line,
`default_installer_address` in `src/setup/installer_contract.cjs`: it is the only place in the
app that names the public repository.

## What it does

- **One quiet window.** No title bar. The window buttons sit in the tab strip.
- **Tabs that show what each chat is doing.** Each tab is one Alfera page. A turning ring means
  the chat is working, an orange dot means it needs you, a green tick means it finished and you
  have not looked yet. Tabs come back after a restart. ⌘T new tab, ⌘W close, ⌘1 to ⌘9 pick a
  tab, ⌘⇧] and ⌘⇧[ next and previous.
- **Hidden tabs sleep.** A tab that was out of sight for 15 minutes closes its page and keeps
  its place. It loads the same chat again when you show it. A tab never sleeps while its chat is
  working or waits for you, while an answer is still arriving, or while a field you can see
  holds text. After a restart only the tab in front loads; the others load when you show them.
- **Tabs are for the person who is signed in.** Until Alfera has said who that is, and after you
  sign out, the strip shows no tab and no chat title. Sign in again and your tabs are back, each
  on the page it was on. Another person who signs in gets none of them. No title is written to
  the settings file.
- **Many tabs.** Every tab has the same width, worked out from the width of the window, the
  sidebar and the number of tabs (`src/window/strip_layout.js`). A name never moves a tab, and
  the "+" stays where it is. With more tabs they get narrower together; past a width that still
  shows a few words, the row scrolls, fades on the side where more tabs are, and the tab in
  front stays in view. A tab whose page loads shows a grey ring.
- **The strip matches the page.** It takes its colours and the sidebar width from the Alfera page
  under it. One rule, in every state of the page: the band over the sidebar is as wide as the
  sidebar and has its colour; the tabs start at its right edge, or right of the window buttons
  when the sidebar is narrower than those (then there is no band). The strip reads the sidebar
  from the page itself, so an open menu, dialog or sheet does not move it, and it follows the
  sidebar while that folds and when you zoom the page. When a dialog or the search dims the
  page, the strip is dimmed with the same colour.
- **Menu bar icon.** It shows how many chats need you, and lists "Needs you" and "Working". Click
  a chat to open it in a tab. Closing the window keeps the icon; Quit ends the app.
- **Quick ask.** ⌥ Space from any app opens a small bar, also over an app in full screen. Type,
  press Return: the question starts a new chat in a new tab. The bar goes away only when the
  chat has the question. When you are signed out, or Alfera does not answer, the question stays
  in the bar with one line that says what to do. When another app holds ⌥ Space, the menus show
  no shortcut for it; "Ask Alfera…" in the File menu still opens the bar.
- **A click stays in its tab.** Click a chat in the sidebar and it opens in the tab you are in,
  as in any app. A new tab comes from ⌘-click, from "+", from ⌘T, and from "Open Link in New
  Tab" on a right click.
- **A new tab is instant.** One Alfera page is always loaded ahead of time, at full size, under
  the page in front.
- **Links.** A link to your Alfera opens in the app, a sign-in link too. Sign-in with Google,
  Slack or an email code stays in the window. Every other web link opens in your browser. A link
  that starts a text message, a mail or a call opens the Mac app for it.
- Right click gives copy, paste and "Open Link in New Tab". ⌘[ and ⌘] go back and forward.
- **A server that cannot be reached.** When a page does not load, when the server answers with an
  error, and when it gives no answer for 20 seconds, the tab shows "Alfera cannot be reached"
  with "Try again". The page tries again by itself, after 5 seconds, then 10, 20, 40, and every
  minute, and says when. The tab keeps its name and its address: quit and open the app, and the
  tab is still there.

The app holds no Alfera password and no session of its own. It reads the chat list and the open
approvals through the page you are signed in to (`src/alfera_api.cjs`), every 4 seconds.

## What needs which server

| Part of the app | Alfera Cloud | Your own server |
|---|---|---|
| Tabs, chat states, menu bar icon, quick ask | yes | yes |
| Sign-in | Google, Slack or an email code | the server's own sign-in: a one-time link, or none on a server for one person on one machine |
| Work in a Folder | only when the server has the relay routes | only when the server has the relay routes |

**Work in a Folder** lets Alfera read and change files in one folder of this Mac. It needs
routes on the server (`/v1/mcp-relays`) that are not part of every Alfera server. The app asks
the server once you are signed in, and shows the two menu rows ("Work in a Folder…" and "Stop
Working in the Folder") only when the server has the routes. When it does:

- Reading runs without asking. Writing, editing and commands ask you first, in the chat.
- A path outside the folder is refused, also through a link.
- A command starts in the folder. On macOS it can write only inside the folder, the temp folders
  and the usual tool caches. It can still read outside the folder.
- No port is opened on the Mac. The app asks Alfera for messages over a connection it opens
  itself (`src/folder/folder_relay.cjs`).

## Change the code

```bash
npm install
npm start
```

- This folder stands alone. It has its own `package.json` and `package-lock.json`, and it uses
  `npm`. It is not a workspace of the repository around it. The empty `"workspaces"` list in
  `package.json` is there on purpose: it stops the app builder from walking up into that
  repository.
- The app holds no secrets and needs no env file.
- Settings live in `~/Library/Application Support/Alfera/settings.json`: the address, the window
  size and the open tabs. Delete that file to see the first run again. The sign-in is a cookie
  in the same folder, so deleting the file signs nobody out.
- The setup screens are a list of step records in `src/setup/setup_steps.js`. One record is one
  screen. `src/setup/setup_page.js` draws any record, and `src/setup/setup_window.cjs` holds the
  work a step can name. A new step is a new record, plus a new entry there when it does work.
  Everything the guided setup decides is in plain files with tests: `server_address.cjs`,
  `installer_progress.cjs`, `installer_contract.cjs`, `ssh_call.cjs`, `server_setup.cjs`,
  `digitalocean_sign_in.cjs`, `digitalocean_server.cjs`, `make_server_for_me.cjs` and
  `deploy_page.cjs`.
- To quit for real, use Quit in the menu bar icon or ⌘Q. Closing the window keeps the app running.

## Check it

```bash
npm test               # expect: pass 234, fail 0
npm run smoke          # starts the app unseen, writes pictures to /tmp, prints one line of JSON, quits
npm run check-setup    # walks the guided setup, every way it can go; about 4 minutes
npm run check-app      # walks the app in every state it can be in; about 4 minutes
```

**Nothing these start reaches the screen.** A run that a script starts is an invisible run
(`ALFERA_INVISIBLE=1`, `src/invisible_run.cjs`): no window shows and none takes the keyboard,
there is no Dock icon, no menu bar icon, no shortcut, no dialog, no sound and no notification, no
link opens in a browser, the keychain is not asked, and the clipboard is a stand-in. Its settings
and sign-in are in a folder of its own, so the Alfera you use is never touched or brought
forward. The scripts start the app from a copy of Electron that macOS gives no Dock icon
(`test/invisible_electron.cjs`; the copy is made once, in `node_modules/.cache`). If a window
shows all the same, the app hides it and ends the run. A fault in the app ends the run too, with
the fault on the error output: the error box of Electron is a window. `npm run smoke`,
`npm run check-setup` and `npm run check-app` set the switch; without it they do not start.

`npm run check-app` starts the real app on a stand-in Alfera server on this Mac
(`test/app_check/stand_in_alfera.cjs`), once for each state: the first run and the setup, signed
out on a server with links and on a server with a sign-in page of its own, signed in with no
tab, one tab and many, tabs from the last time, a tab that slept, a question through the bar,
and a server that is away, answers with an error, or does not answer. In each state it chooses
every row of every menu, also the grey ones, and presses what the strip offers. The app must
never throw, and only what belongs to the state may do anything.
`ALFERA_INVISIBLE=1 node test/app_check/check_app.cjs <name>` does one run. A page that is never
on the screen draws no frame by itself, so the check asks for one where a new size or a new zoom
must take hold.

`npm run check-setup` starts the real app 40 times, each time on a new empty folder, and presses
its way through the guided setup: once to the end, and once for each way a setup can stop. Two
runs open the deploy page: a stand-in on this Mac (`test/setup_check/stand_in_deploy_page.cjs`)
that opens the setup page of the stand-in server, and an address where nothing answers. The
one thing it replaces is `ssh`: `test/setup_check/ssh` is first on the `PATH` of the run, connects
to nothing, and answers with the recorded lines in `test/setup_check/scenarios.cjs`. A small
https server on this Mac stands in for the installed Alfera; the app is started with two
switches that send the name of the server to it and accept its certificate, which `openssl`
makes for the run. In every run it asks the app and macOS that nothing shows, and the whole
check stops at once when something does. It prints one line for each run and exits 1 when any
screen shows the wrong state. `ALFERA_INVISIBLE=1 node test/setup_check/check_setup.mjs <name>`
does one run.

`npm run smoke` prints the page it landed on, how many tabs are open and asleep, and the
resident memory of the whole app. It runs on a new empty folder, so it shows the first run, and
writes `/tmp/alfera-desktop-first-run.png`. With an address it writes
`/tmp/alfera-desktop-strip.png` (the tab strip), `/tmp/alfera-desktop-smoke.png` (the page) and
`/tmp/alfera-desktop-menu-bar-icon.png`:

```bash
ALFERA_ADDRESS=http://localhost:3000 npm run smoke
npm run smoke -- --user-data-dir=/tmp/alfera-smoke     # keeps its folder for the next run
```

`npm start` is the one command here that shows the app. It uses your real settings and sign-in,
and the app runs once at a time: if Alfera is already open, it only brings it to the front.

- `ALFERA_ADDRESS=http://localhost:3000` uses another address for one run and skips the first run.
- `ALFERA_TAB_SLEEP_MINUTES=1` changes how long a hidden tab stays awake.
- `ALFERA_SMOKE_WAIT_MS=15000` lets the smoke run wait longer before it takes the pictures.
- `ALFERA_FOLDER=/some/folder` works in that folder without the dialog.
- `ALFERA_INSTALLER_ADDRESS` and `ALFERA_INSTALLER_SOURCE_ARCHIVE` make the guided setup install
  from a copy of the source, for a test: the address that holds `install.sh`, and the address of
  a `.tar.gz` of the source. The server reads both, so `http://127.0.0.1:...` there means the
  server itself.
- `ALFERA_DIGITALOCEAN_SIGN_IN_ADDRESS` and `ALFERA_DIGITALOCEAN_API_ADDRESS` send the sign-in and
  the API calls of "Make your server" to a stand-in, for a test. A packaged app ignores both.
- `ALFERA_DEPLOY_PAGE_ADDRESS` opens another deploy page for "Set it up", for a test or a local
  web app (`http://localhost:3000/deploy`). A packaged app ignores it.

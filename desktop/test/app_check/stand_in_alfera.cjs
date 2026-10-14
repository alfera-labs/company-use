// A stand-in for an Alfera server, for `npm run check-app`. It runs in the process of the check,
// on this Mac only, and answers the few routes the desktop app uses: the pages, who is signed
// in, the chats, a new chat, and a sign-in link. The check changes `state` to make it a server
// that asks for a sign-in link, a server with a sign-in page of its own, a server that answers
// with an error, or one that does not answer at all.
const http = require('node:http');

const person = { id: 'user_stand_in_1' };
const titles_by_path = { '/': 'Alfera', '/home': 'Alfera', '/inbox': 'Inbox · Alfera', '/scheduled-tasks': 'Scheduled tasks · Alfera', '/projects': 'Projects · Alfera', '/profile': 'Profile · Alfera', '/sign-in': 'Sign in' };
const first_chats = () => [
  { session_id: 'ses_aaa1', session_title: 'Plan the week', is_unread: false, latest_run: { run_status: 'completed' } },
  { session_id: 'ses_bbb2', session_title: 'A report with a long name that does not fit in a tab', is_unread: false, latest_run: { run_status: 'completed' } },
  { session_id: 'ses_ccc3', session_title: 'Untitled session', is_unread: false, latest_run: null },
];

function create_state() {
  return {
    // none: everyone is the one person. link: pages ask for a sign-in link. own_page: the
    // server sends a person who is not signed in to its own sign-in page.
    sign_in: 'none',
    links_that_work: new Set(),
    cookies_signed_in: new Set(),
    // null, a status such as 500, or "never" for a server that takes the request and says nothing.
    answers_pages_with: null,
    takes_questions: true,
    offers_folder_work: false,
    chats: first_chats(),
    questions: [],
    times_the_chats_were_read: [],
    next_number: 1,
  };
}

// The same parts as the real page that the app reads: a sidebar it can name, 248 wide, with a
// line at its right edge; solid colours; links to click; and a layer that dims the page on ask.
function page_html(pathname, state) {
  const title = titles_by_path[pathname] ?? (pathname.startsWith('/chats') ? 'Chats · Alfera' : 'Alfera');
  const chat_links = state.chats.map((chat) => `<a href="/chats/${chat.session_id}">${chat.session_title}</a>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
    body { margin:0; background:rgb(251,250,249); color:rgb(28,26,23); font:14px sans-serif; }
    aside { position:fixed; left:0; top:0; bottom:0; width:248px; box-sizing:border-box; background:rgb(237,236,234); border-right:1px solid rgb(227,225,220); }
    aside a { display:block; padding:6px 12px; }
    main { margin-left:248px; height:100vh; overflow-y:auto; padding:20px; box-sizing:border-box; background:rgb(251,250,249); }
    .long { height:${pathname.startsWith('/chats/') ? 3000 : 0}px; }
    .backdrop { position:fixed; inset:0; background:rgba(0, 0, 0, 0.3); }
  </style></head><body><div id="app">
    <aside data-slot="sidebar"><a href="/home">New chat</a><a href="/inbox">Inbox</a><a href="/scheduled-tasks">Scheduled tasks</a><a href="/projects">Projects</a>${chat_links}</aside>
    <main><h1>${pathname}</h1><a id="opens_a_window" target="_blank" href="/profile">Profile</a><textarea id="question"></textarea><div class="long"></div></main>
  </div><script>
    window.show_an_answer_under_way = (is_under_way) => { document.querySelector('[aria-label="Stop response"]')?.remove(); if (!is_under_way) return; const stop = document.createElement('button'); stop.setAttribute('aria-label', 'Stop response'); document.querySelector('main').append(stop); };
    window.dim_the_page = (is_dimmed) => { document.querySelector('.backdrop')?.remove(); if (!is_dimmed) return; const layer = document.createElement('div'); layer.className = 'backdrop'; layer.dataset.slot = 'dialog-backdrop'; document.body.append(layer); };
  </script></body></html>`;
}

function start_stand_in_alfera() {
  let state = create_state();
  const sockets = new Set();
  const cookie_of = (request) => /alfera_stand_in=([a-z0-9]+)/.exec(request.headers.cookie ?? '')?.[1] ?? null;
  const is_signed_in = (request) => state.sign_in === 'none' || state.cookies_signed_in.has(cookie_of(request));
  const send = (response, status, type, body, headers = {}) => {
    response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers });
    response.end(body);
  };
  const send_json = (response, status, body) => send(response, status, 'application/json', JSON.stringify(body));
  const read_body = async (request) => {
    let text = '';
    for await (const piece of request) text += piece;
    return text ? JSON.parse(text) : {};
  };

  async function answer_the_api(request, response, url) {
    if (url.pathname === '/api/health') return send_json(response, 200, { data: { status: 'ok' } });
    if (!is_signed_in(request)) return send_json(response, 401, { error: { code: 'unauthorized' } });
    if (url.pathname === '/auth/session') return send_json(response, 200, { user: person });
    if (url.pathname === '/api/v1/approvals') return send_json(response, 200, { data: [] });
    if (url.pathname === '/api/v1/mcp-relays/none/messages') return send_json(response, state.offers_folder_work ? 400 : 404, {});
    if (url.pathname === '/api/v1/sessions' && request.method === 'GET') {
      state.times_the_chats_were_read.push(Date.now());
      return send_json(response, 200, { data: state.chats });
    }
    if (url.pathname === '/api/v1/sessions' && request.method === 'POST') {
      const chat = { session_id: `ses_new${state.next_number++}`, session_title: 'Untitled session', is_unread: false, latest_run: null };
      state.chats.push(chat);
      return send_json(response, 201, { data: { session_id: chat.session_id } });
    }
    const queued = /^\/api\/v1\/sessions\/(ses_[a-z0-9]+)\/queued-messages$/.exec(url.pathname);
    if (queued && request.method === 'POST') {
      if (!state.takes_questions) return send_json(response, 500, { error: { code: 'server_error' } });
      state.questions.push({ session_id: queued[1], ...(await read_body(request)) });
      return send_json(response, 202, { data: {} });
    }
    return send_json(response, 404, { error: { code: 'not_found' } });
  }

  // A sign-in link works once.
  function answer_a_sign_in_link(response, token) {
    if (!state.links_that_work.delete(token)) return send(response, 404, 'text/html', '<title>This sign-in link is not valid</title><p>Ask for a new one.</p>');
    const cookie = `c${state.next_number++}`;
    state.cookies_signed_in.add(cookie);
    return send(response, 302, 'text/html', '', { location: '/', 'set-cookie': `alfera_stand_in=${cookie}; Path=/; HttpOnly` });
  }

  function answer_a_page(request, response, url) {
    if (state.answers_pages_with === 'never') return undefined;
    if (state.answers_pages_with) return send(response, state.answers_pages_with, 'text/plain', 'Bad Gateway');
    if (url.pathname.startsWith('/join/')) return answer_a_sign_in_link(response, url.pathname.slice('/join/'.length));
    if (url.pathname === '/sign-in') return send(response, 200, 'text/html', page_html('/sign-in', state));
    if (is_signed_in(request)) return send(response, 200, 'text/html', page_html(url.pathname, state));
    if (state.sign_in === 'own_page') return send(response, 302, 'text/html', '', { location: `/sign-in?returnTo=${encodeURIComponent(url.pathname)}` });
    return send(response, 401, 'text/html', '<title>This Alfera needs a sign-in link</title><style>body { background: Canvas; }</style><p>This Alfera needs a sign-in link.</p>', { 'x-coworker-auth-required': 'sign-in-link' });
  }

  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://stand-in');
    const is_api = url.pathname.startsWith('/api/') || url.pathname === '/auth/session';
    Promise.resolve(is_api ? answer_the_api(request, response, url) : answer_a_page(request, response, url)).catch(() => send_json(response, 500, {}));
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  let port = 0;
  const listen = () => new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve((port = server.address().port))));
  // A server that is away: nothing listens, and every open connection is cut.
  const go_away = () => new Promise((resolve) => {
    server.close(resolve);
    for (const socket of sockets) socket.destroy();
  });

  return listen().then(() => ({
    address: `http://127.0.0.1:${port}`,
    host: `127.0.0.1:${port}`,
    read_state: () => state,
    start_over: () => (state = create_state()),
    make_sign_in_link: () => {
      const token = `stand-in-token-${state.next_number++}-abcdefghijklmnop`;
      state.links_that_work.add(token);
      return { token, link: `http://127.0.0.1:${port}/join/${token}` };
    },
    sign_everyone_out: () => state.cookies_signed_in.clear(),
    go_away,
    come_back: listen,
  }));
}

module.exports = { start_stand_in_alfera };

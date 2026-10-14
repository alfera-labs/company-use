const { ask_alfera_as_the_signed_in_person } = require('./alfera_api.cjs');

const seconds_between_reads = 4;

// A chat that waits for a yes still reports its run as "running", so the open approvals decide
// "needs you" first.
function read_state(session, waits_for_a_yes = false) {
  const run_status = session.latest_run?.run_status;
  if (waits_for_a_yes || run_status === 'waiting') return 'needs_you';
  if (run_status === 'running' || run_status === 'queued') return 'working';
  if (run_status === 'failed' && session.is_unread) return 'needs_you';
  // A tick means "finished, and you have not looked yet". A chat you already read shows nothing.
  return run_status === 'completed' && session.is_unread ? 'done' : null;
}

const status_when_nobody_is_signed_in = 401;
const name_for_a_person_alfera_does_not_name = 'someone';

// Who the chat list belongs to: the id Alfera gives the signed-in person, null when Alfera says
// nobody is signed in, and undefined when it gave no clear answer (no connection, a page that
// is not Alfera). An older Alfera that does not say who is signed in still has one person.
function read_person(chats, session) {
  if (chats.status === status_when_nobody_is_signed_in) return null;
  if (chats.status !== 200 || !Array.isArray(chats.body?.data)) return undefined;
  return session.body?.user?.id ?? name_for_a_person_alfera_does_not_name;
}

// Asks Alfera who is signed in, for that person's chats, and what each chat is doing. The tabs,
// the menu bar icon and the dock badge all show this one answer.
// Reads the whole chat list on a timer. Listen to Alfera's live events instead when the
// list is long or the timer shows up in server load.
function watch_sessions({ read_page, on_change, on_person }) {
  let last_answer = '';
  let is_reading = false;

  const read = async () => {
    const [chats, approvals, session] = await Promise.all([
      ask_alfera_as_the_signed_in_person(read_page(), { path: '/v1/sessions' }),
      ask_alfera_as_the_signed_in_person(read_page(), { path: '/v1/approvals?status=waiting' }),
      ask_alfera_as_the_signed_in_person(read_page(), { page_path: '/auth/session' }),
    ]);
    const person = read_person(chats, session);
    if (person === undefined) return;
    on_person(person);
    // Nobody is signed in: no chat of the person before is kept, here or by those who listen.
    const waiting_session_ids = new Set(
      (approvals.body?.data ?? []).map((approval) => approval.session_id),
    );
    const sessions = Object.fromEntries(
      (person === null ? [] : chats.body.data).map((session_row) => [
        session_row.session_id,
        {
          title: session_row.session_title ?? '',
          state: read_state(session_row, waiting_session_ids.has(session_row.session_id)),
        },
      ]),
    );
    const text = JSON.stringify(sessions);
    if (text === last_answer) return;
    last_answer = text;
    on_change(sessions);
  };

  // Many tabs can ask at once, for example when the app opens. One read at a time is enough.
  const read_now = async () => {
    if (is_reading) return;
    is_reading = true;
    try {
      await read();
    } finally {
      is_reading = false;
    }
  };

  const timer = setInterval(() => read_now().catch(() => {}), seconds_between_reads * 1000);
  return { read_now, stop: () => clearInterval(timer) };
}

function sessions_in_state(sessions, state) {
  return Object.entries(sessions)
    .filter(([, session]) => session.state === state)
    .map(([session_id, session]) => ({ session_id, title: session.title || 'Untitled chat' }));
}

module.exports = { watch_sessions, sessions_in_state, read_state, read_person };

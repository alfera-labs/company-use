const { parse_web_address } = require('../settings.cjs');

const seconds_to_wait_for_an_answer = 8;

// The person types the address of a server, or pastes a page on it. A sign-in link is such a
// page: the server becomes the address, and the link is the first page the app opens.
// An address typed with no "https://" in front gets it.
const address_with_no_start = /^[a-z0-9.-]+(?::\d+)?(?:\/\S*)?$/i;

function parse_address_choice(text) {
  const typed = String(text).trim();
  const with_a_start = address_with_no_start.test(typed) ? `https://${typed}` : typed;
  const url = parse_web_address(typed) ?? parse_web_address(with_a_start);
  return url ? { address: url.origin, first_page: url.href } : null;
}

// Every Alfera server answers /api/health in the same JSON shape: the health itself when the
// person is signed in or the server needs no sign-in, and a named refusal when they are not.
// Another product that answers this path in the same shape passes. Read a field that
// names Alfera when the server has one.
function answers_like_alfera(body) {
  return body?.data?.status === 'ok' || typeof body?.error?.code === 'string';
}

// Returns one sentence that says what is wrong with the address, or null when Alfera answers.
async function find_address_problem(address, fetch) {
  const host = new URL(address).host;
  let answer;
  try {
    answer = await fetch(`${address}/api/health`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(seconds_to_wait_for_an_answer * 1000),
    });
  } catch {
    return `Nothing answers at ${host}, so check the address and that your server is running.`;
  }
  const body = await answer.json().catch(() => null);
  if (answers_like_alfera(body)) return null;
  return `${host} answers, but not like an Alfera server, so check the address.`;
}

module.exports = { parse_address_choice, find_address_problem };

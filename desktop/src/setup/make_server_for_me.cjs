const { DigitalOceanRefused, make_digitalocean_server } = require('./digitalocean_server.cjs');
const { DigitalOceanSignInStopped, give_back_the_token, sign_in_to_digitalocean } = require('./digitalocean_sign_in.cjs');
const { plain_text_of } = require('./plain_text.cjs');
const { setTimeout: wait } = require('node:timers/promises');

const kinds_a_new_server_has_for_a_while = ['nothing_answers', 'key_refused', 'connection_lost'];
const most_seconds_until_a_new_server_lets_the_app_in = 180;
const seconds_between_tries = 5;

const words_by_reason = {
  not_authorized: 'DigitalOcean did not let the app make the server. Press the button again, then press "Authorize".',
  no_token: 'DigitalOcean gave the app no access. Press the button again.',
  no_answer: 'The app got no answer from DigitalOcean in 10 minutes. Press the button again.',
  not_reachable: 'The app could not reach DigitalOcean. Check your internet connection, then try again.',
  no_region: 'DigitalOcean has no place with a free server of this size right now. Try again later.',
  no_address: 'DigitalOcean made the server, but it got no address in 5 minutes. Try again: the app uses the same server.',
  stopped: 'The app stopped making the server. Press the button again.',
  not_let_in: 'The new server does not let the app in yet. Wait a minute, then try again: the app uses the same server.',
};

function words_for(error) {
  if (error.words) return `DigitalOcean did not make the server. It says: "${plain_text_of(error.words).trim()}"`;
  if (error.status) return `DigitalOcean answered with an error (code ${error.status}). Try again in a minute.`;
  return words_by_reason[error.reason] ?? words_by_reason.not_reachable;
}

async function wait_until_the_server_lets_the_app_in({ server_setup, host, signal }) {
  const ends_at = Date.now() + most_seconds_until_a_new_server_lets_the_app_in * 1000;
  for (;;) {
    const outcome = await server_setup.check_server(host);
    signal.throwIfAborted();
    if (!outcome.problem) return {};
    if (!kinds_a_new_server_has_for_a_while.includes(outcome.kind)) return { problem: outcome.problem };
    if (Date.now() > ends_at) return { problem: words_by_reason.not_let_in };
    await wait(seconds_between_tries * 1000, undefined, { signal });
  }
}

async function make_server_for_me({ server_setup, size, addresses_given_up, open_in_browser, signal }) {
  let token = null;
  try {
    token = await sign_in_to_digitalocean({ open_in_browser, signal });
    const public_key = await server_setup.read_public_key();
    const host = await make_digitalocean_server({ token, public_key, size, addresses_given_up, signal });
    return await wait_until_the_server_lets_the_app_in({ server_setup, host, signal });
  } catch (error) {
    if (signal.aborted) return { problem: words_by_reason.stopped };
    if (!(error instanceof DigitalOceanRefused || error instanceof DigitalOceanSignInStopped)) throw error;
    return { problem: words_for(error) };
  } finally {
    if (token) await give_back_the_token(token);
  }
}

module.exports = { make_server_for_me, words_by_reason };

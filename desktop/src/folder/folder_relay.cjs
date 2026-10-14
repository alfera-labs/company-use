const { net } = require('electron');
const { answer_mcp_message } = require('./folder_mcp_server.cjs');

const longest_wait_seconds = 25;
const first_retry_ms = 2_000;
const longest_retry_ms = 30_000;

// The app asks Alfera for messages over a connection it opens itself, runs each one against the
// folder, and sends the answer back. Nothing on this computer listens for incoming connections.
function listen_for_folder_messages({ relay, read_folder, on_token_refused }) {
  const stop_signal = new AbortController();
  const headers = {
    authorization: `Bearer ${relay.device_token}`,
    'content-type': 'application/json',
  };

  const answer = async ({ mcp_relay_message_id, request_message }) => {
    const response_message = await answer_mcp_message(read_folder(), request_message);
    await net.fetch(`${relay.relay_address}/messages/${mcp_relay_message_id}/answer`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ response_message }),
    });
  };

  const listen_once = async () => {
    const url = `${relay.relay_address}/messages?wait_seconds=${longest_wait_seconds}`;
    const listened = await net.fetch(url, { headers, signal: stop_signal.signal });
    if (listened.status === 401) return 'token_refused';
    if (!listened.ok) throw new Error(`Alfera answered ${listened.status}`);
    const { data } = await listened.json();
    // Not awaited: a long command must not stop the next message from being picked up.
    for (const message of data.messages) answer(message).catch(() => {});
    return 'listened';
  };

  const listen_until_stopped = async () => {
    let retry_ms = first_retry_ms;
    while (!stop_signal.signal.aborted) {
      try {
        if ((await listen_once()) === 'token_refused') return on_token_refused();
        retry_ms = first_retry_ms;
      } catch {
        if (stop_signal.signal.aborted) return;
        await new Promise((resolve) => setTimeout(resolve, retry_ms));
        retry_ms = Math.min(retry_ms * 2, longest_retry_ms);
      }
    }
  };

  listen_until_stopped();
  return { stop: () => stop_signal.abort() };
}

module.exports = { listen_for_folder_messages };

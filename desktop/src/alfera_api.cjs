const { read_address } = require('./settings.cjs');

function is_an_alfera_page(contents) {
  try {
    return new URL(contents.getURL()).host === new URL(read_address()).host;
  } catch {
    return false;
  }
}

// Runs in the page, so it is the same call the web app makes, with the person's own sign-in.
// The desktop app keeps no Alfera password or session of its own. `path` is a path of the API;
// `page_path` is a path of the web app itself.
async function ask_alfera_as_the_signed_in_person(contents, { method = 'GET', path, page_path, body }) {
  if (!contents || contents.isDestroyed() || !is_an_alfera_page(contents))
    return { status: 0, body: null };
  const request = {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
  const script = `fetch(${JSON.stringify(page_path ?? `/api${path}`)}, ${JSON.stringify(request)})
    .then(async (response) => ({ status: response.status, body: await response.json().catch(() => null) }))
    .catch(() => ({ status: 0, body: null }))`;
  return contents.executeJavaScript(script);
}

module.exports = { ask_alfera_as_the_signed_in_person, is_an_alfera_page };

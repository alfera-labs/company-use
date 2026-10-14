/** On every answer of a team install to a request for data that came with no valid session. */
export const team_session_ended_header = 'X-Coworker-Team-Session-Ended';

/**
 * An open app keeps showing what it has when its session ends: a person who was removed went
 * on reading her chats until she reloaded. So the first answer that carries the header loads
 * the page again, once, and that request gets the plain page that says what happened. Only a
 * team install sends the header, so nothing changes for any other install.
 */
export function reload_when_the_team_session_ended(
  browser: { fetch: SendRequest; location: Pick<Location, 'reload'> } = window,
) {
  const plain_fetch = browser.fetch.bind(browser);
  let is_reloading = false;
  browser.fetch = async (...request) => {
    const response = await plain_fetch(...request);
    if (!is_reloading && response.headers.has(team_session_ended_header)) {
      is_reloading = true;
      browser.location.reload();
    }
    return response;
  };
}

type SendRequest = (...request: Parameters<typeof fetch>) => Promise<Response>;

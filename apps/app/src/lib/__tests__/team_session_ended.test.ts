import { describe, expect, it, vi } from 'vitest';
import {
  reload_when_the_team_session_ended,
  team_session_ended_header,
} from '@/lib/team_session_ended';

function browser_that_gets(answers: Response[]) {
  const browser = {
    fetch: async (_address: string | URL | Request) => answers.shift() ?? new Response('ok'),
    location: { reload: vi.fn() },
  };
  reload_when_the_team_session_ended(browser);
  return browser;
}

const session_ended = () =>
  new Response('{}', { status: 401, headers: { [team_session_ended_header]: '1' } });

describe('an open app whose session ended', () => {
  it('goes on as it is while every answer is an ordinary one', async () => {
    const browser = browser_that_gets([new Response('ok'), new Response('{}', { status: 401 })]);

    await browser.fetch('/api/v1/sessions');
    const refused = await browser.fetch('/api/v1/sessions');

    expect(refused.status).toBe(401);
    expect(browser.location.reload).not.toHaveBeenCalled();
  });

  it('loads the page again at the first answer that says the session ended', async () => {
    const browser = browser_that_gets([new Response('ok'), session_ended()]);

    await browser.fetch('/home');
    expect(browser.location.reload).not.toHaveBeenCalled();
    const refused = await browser.fetch('/home');

    expect(refused.status).toBe(401);
    expect(browser.location.reload).toHaveBeenCalledTimes(1);
  });

  it('loads it once, however many requests were on their way', async () => {
    const browser = browser_that_gets([session_ended(), session_ended(), session_ended()]);

    await Promise.all([browser.fetch('/a'), browser.fetch('/b'), browser.fetch('/c')]);

    expect(browser.location.reload).toHaveBeenCalledTimes(1);
  });
});

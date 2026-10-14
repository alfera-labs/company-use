import { create_slack_parallel_playwright_sender } from '@coworker/evals/slack_parallel_playwright_sender';
import { chromium } from '@playwright/test';
import { afterEach, describe, expect, it } from 'vitest';

const opened_browsers: Array<Awaited<ReturnType<typeof chromium.launch>>> = [];

afterEach(async () => {
  await Promise.all(opened_browsers.splice(0).map((browser) => browser.close()));
});

describe('create_slack_parallel_playwright_sender', () => {
  it('keeps fifteen identity checks and composer writes scoped to independent pages', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    opened_browsers.push(browser);
    const context = await browser.newContext();
    const fixtures = await Promise.all(
      Array.from({ length: 15 }, async (_, index) => {
        const suffix = String(index).padStart(2, '0');
        const team_id = `T0EVAL${suffix}`;
        const channel_id = `C0EVAL${suffix}`;
        const user_id = `U0EVAL${suffix}`;
        const page = await context.newPage();
        await page.route(`https://app.slack.com/client/${team_id}/${channel_id}`, async (route) => {
          await route.fulfill({
            contentType: 'text/html',
            body: slack_fixture_html(team_id, user_id),
          });
        });
        return {
          page,
          user_id,
          sender: create_slack_parallel_playwright_sender({ page, team_id, channel_id }),
        };
      }),
    );

    await Promise.all(
      fixtures.map(({ sender, user_id }) =>
        sender.post_message_if_user?.({
          text: `Build the launch map for ${user_id}.`,
          expected_user_id: user_id,
        }),
      ),
    );

    const messages = await Promise.all(
      fixtures.map(({ page }) => page.locator('[data-qa="texty_input"]').textContent()),
    );
    expect(messages).toEqual(
      fixtures.map(({ user_id }) =>
        expect.stringContaining(`Build the launch map for ${user_id}.`),
      ),
    );
  });

  it('does not type when the team page belongs to another Slack user', async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    opened_browsers.push(browser);
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.route('https://app.slack.com/client/T0EVAL/C0EVAL', async (route) => {
      await route.fulfill({
        contentType: 'text/html',
        body: slack_fixture_html('T0EVAL', 'U0OTHER'),
      });
    });
    const sender = create_slack_parallel_playwright_sender({
      page,
      team_id: 'T0EVAL',
      channel_id: 'C0EVAL',
    });

    await expect(
      sender.post_message_if_user?.({
        text: 'Build the launch map.',
        expected_user_id: 'U0EVAL',
      }),
    ).rejects.toThrow('expected installer U0EVAL');
    await expect(page.locator('[data-qa="texty_input"]').textContent()).resolves.toBe('');
  });
});

function slack_fixture_html(team_id: string, user_id: string) {
  return `<!doctype html>
    <html>
      <body>
        <div
          aria-label="Message to general"
          contenteditable="true"
          data-qa="texty_input"
          data-team-id="${team_id}"
        ></div>
        <div role="listbox"><div role="option">Alfera</div></div>
        <script>
          localStorage.setItem('persist-v1::${team_id}::${user_id}::identity', 'true');
        </script>
      </body>
    </html>`;
}

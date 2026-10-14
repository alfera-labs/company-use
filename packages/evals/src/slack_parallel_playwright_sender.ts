import type { SlackEvalSender } from '@coworker/evals/slack_eval_sender';
import type { Page } from '@playwright/test';

const slack_bot_mention = '@Alfera';

export type SlackParallelPlaywrightSender = SlackEvalSender & {
  close(): Promise<void>;
};

export function create_slack_parallel_playwright_sender(input: {
  page: Page;
  team_id: string;
  channel_id: string;
}): SlackParallelPlaywrightSender {
  const team_id = require_slack_identifier(input.team_id, 'team_id', 'T');
  const channel_id = require_slack_identifier(input.channel_id, 'channel_id', 'C');
  const composer_selector = `[data-qa="texty_input"][data-team-id="${team_id}"][aria-label^="Message to"]`;
  let channel_opened = false;

  async function open_channel() {
    if (channel_opened) return;
    await input.page.goto(`https://app.slack.com/client/${team_id}/${channel_id}`, {
      waitUntil: 'domcontentloaded',
    });
    await input.page.locator(composer_selector).waitFor({ state: 'visible' });
    channel_opened = true;
  }

  async function get_user_id() {
    await open_channel();
    return read_slack_page_user_id(input.page, team_id);
  }

  async function post_message(text: string) {
    const composer = input.page.locator(composer_selector);
    await composer.fill(slack_bot_mention);
    await input.page.locator('[role="listbox"] [role="option"]').first().waitFor({
      state: 'visible',
    });
    await input.page.keyboard.press('Enter');
    await input.page.keyboard.type(text);
    await input.page.keyboard.press('Enter');
  }

  return {
    get_user_id,
    post_message: async ({ text }) => {
      await open_channel();
      await post_message(text);
    },
    post_message_if_user: async ({ text, expected_user_id }) => {
      const user_id = await get_user_id();
      if (user_id !== expected_user_id) {
        throw new Error(
          `Slack browser page belongs to ${user_id}, expected installer ${expected_user_id}.`,
        );
      }
      await post_message(text);
    },
    close: () => input.page.close(),
  };
}

async function read_slack_page_user_id(page: Page, team_id: string) {
  const target_team_id = require_slack_identifier(team_id, 'team_id', 'T');
  const user_ids = await page.evaluate((target_team_id) => {
    return [
      ...new Set(
        Object.keys(localStorage)
          .map(
            (key) => key.match(new RegExp(`^persist-v1::${target_team_id}::(U[A-Z0-9]+)::`))?.[1],
          )
          .filter((value): value is string => Boolean(value)),
      ),
    ];
  }, target_team_id);
  if (user_ids.length !== 1 || !/^U[A-Z0-9]+$/u.test(user_ids[0] ?? '')) {
    throw new Error('The Slack browser page did not expose one unambiguous user identity.');
  }
  return user_ids[0] as string;
}

function require_slack_identifier(value: string, label: string, prefix: 'C' | 'T') {
  if (!new RegExp(`^${prefix}[A-Z0-9]+$`, 'u').test(value)) {
    throw new Error(`${label} must be a Slack ${prefix} identifier.`);
  }
  return value;
}

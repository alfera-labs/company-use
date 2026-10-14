import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { default_browser_command } from '@coworker/evals/slack_eval_browser_defaults';

const slack_bot_mention = '@Alfera';

const exec_file = promisify(execFile);

export type SlackEvalSender = {
  get_user_id(): Promise<string>;
  post_message(input: { text: string }): Promise<void>;
  post_message_if_user?(input: { text: string; expected_user_id: string }): Promise<void>;
};

type BrowserCommand = (arguments_: string[]) => Promise<string>;

export function create_slack_eval_sender(input: {
  team_id: string;
  channel_id: string;
  browser_command?: string;
  run_browser_command?: BrowserCommand;
  activate_channel_for_each_operation?: boolean;
}): SlackEvalSender {
  const composer_selector = `[data-qa="texty_input"][data-team-id="${input.team_id}"][aria-label^="Message to"]`;
  const run_browser_command =
    input.run_browser_command ??
    create_browser_command(input.browser_command ?? default_browser_command);
  let channel_opened = false;

  async function open_channel() {
    if (channel_opened && !input.activate_channel_for_each_operation) return;
    await run_browser_command([
      input.activate_channel_for_each_operation ? 'goto' : 'newtab',
      `https://app.slack.com/client/${input.team_id}/${input.channel_id}`,
    ]);
    await run_browser_command(['wait', composer_selector]);
    channel_opened = true;
  }

  return {
    get_user_id: async () => {
      await open_channel();
      return read_user_id(run_browser_command, input.team_id);
    },
    post_message: async ({ text }) => {
      await open_channel();
      await enter_message(run_browser_command, composer_selector, text);
    },
    post_message_if_user: async ({ text, expected_user_id }) => {
      await open_channel();
      const user_id = await read_user_id(run_browser_command, input.team_id);
      if (user_id !== expected_user_id) {
        throw new Error(
          `Slack browser session belongs to ${user_id}, expected installer ${expected_user_id}.`,
        );
      }
      await enter_message(run_browser_command, composer_selector, text);
    },
  };
}

async function read_user_id(run_browser_command: BrowserCommand, team_id: string) {
  const expression = `[...new Set(Object.keys(localStorage).map((key) => key.match(/^persist-v1::${team_id}::(U[A-Z0-9]+)::/)?.[1]).filter(Boolean))].join(',')`;
  const user_ids = (await run_browser_command(['js', expression]))
    .trim()
    .split(',')
    .filter(Boolean);
  if (user_ids.length !== 1 || !/^U[A-Z0-9]+$/.test(user_ids[0] ?? '')) {
    throw new Error('The Slack browser session did not expose one unambiguous user identity.');
  }
  return user_ids[0] as string;
}

async function enter_message(
  run_browser_command: BrowserCommand,
  composer_selector: string,
  text: string,
) {
  await run_browser_command(['fill', composer_selector, slack_bot_mention]);
  await run_browser_command(['wait', '[role="listbox"] [role="option"]']);
  await run_browser_command(['press', 'Enter']);
  await run_browser_command(['type', text]);
  await run_browser_command(['press', 'Enter']);
}

export function create_browser_command(command: string): BrowserCommand {
  return async (arguments_) => {
    try {
      const result = await exec_file(command, arguments_, {
        timeout: 30_000,
        maxBuffer: 2_000_000,
        env: slack_browser_process_environment(),
      });
      return result.stdout;
    } catch (error) {
      const operation = arguments_[0] ?? 'unknown';
      const error_code = read_error_code(error);
      throw new Error(
        `Slack browser ${operation} command failed${error_code ? ` (${error_code})` : ''}.`,
      );
    }
  };
}

export function slack_browser_process_environment() {
  const home_directory = os.homedir();
  const username = os.userInfo().username;
  return {
    HOME: home_directory,
    USER: username,
    LOGNAME: username,
    TMPDIR: os.tmpdir(),
    PATH: [
      path.dirname(process.execPath),
      path.join(home_directory, '.local/bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
    ].join(':'),
  };
}

function read_error_code(error: unknown) {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

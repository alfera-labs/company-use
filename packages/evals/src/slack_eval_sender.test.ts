import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  create_browser_command,
  create_slack_eval_sender,
} from '@coworker/evals/slack_eval_sender';
import { describe, expect, it } from 'vitest';

describe('create_slack_eval_sender', () => {
  it('opens the authenticated Slack UI, selects the real mention, and sends the prompt', async () => {
    const commands: string[][] = [];
    const sender = create_slack_eval_sender({
      team_id: 'T0EVAL',
      channel_id: 'C0EVAL',
      run_browser_command: async (arguments_) => {
        commands.push(arguments_);
        return arguments_[0] === 'js' ? 'U0EVAL\n' : '';
      },
    });

    await expect(sender.get_user_id()).resolves.toBe('U0EVAL');
    await sender.post_message({ text: 'Build the launch map.' });

    expect(commands).toEqual([
      ['newtab', 'https://app.slack.com/client/T0EVAL/C0EVAL'],
      ['wait', expect.stringContaining('[data-qa="texty_input"]')],
      ['js', expect.stringContaining('persist-v1::T0EVAL')],
      ['fill', expect.any(String), '@Alfera'],
      ['wait', '[role="listbox"] [role="option"]'],
      ['press', 'Enter'],
      ['type', 'Build the launch map.'],
      ['press', 'Enter'],
    ]);
  });

  it('fails when the browser is not signed in to the target workspace', async () => {
    const sender = create_slack_eval_sender({
      team_id: 'T0EVAL',
      channel_id: 'C0EVAL',
      run_browser_command: async (arguments_) => (arguments_[0] === 'js' ? 'null\n' : ''),
    });

    await expect(sender.get_user_id()).rejects.toThrow(
      'did not expose one unambiguous user identity',
    );
  });

  it('re-activates an isolated fixture channel before every browser operation', async () => {
    const commands: string[][] = [];
    const sender = create_slack_eval_sender({
      team_id: 'T0EVAL',
      channel_id: 'C0EVAL',
      activate_channel_for_each_operation: true,
      run_browser_command: async (arguments_) => {
        commands.push(arguments_);
        return arguments_[0] === 'js' ? 'U0EVAL\n' : '';
      },
    });

    await sender.get_user_id();
    await sender.post_message({ text: 'Build the launch map.' });

    expect(commands.filter(([command]) => command === 'goto')).toEqual([
      ['goto', 'https://app.slack.com/client/T0EVAL/C0EVAL'],
      ['goto', 'https://app.slack.com/client/T0EVAL/C0EVAL'],
    ]);
  });

  it('verifies the fixture identity and posts in one channel activation', async () => {
    const commands: string[][] = [];
    const sender = create_slack_eval_sender({
      team_id: 'T0EVAL',
      channel_id: 'C0EVAL',
      activate_channel_for_each_operation: true,
      run_browser_command: async (arguments_) => {
        commands.push(arguments_);
        return arguments_[0] === 'js' ? 'U0EVAL\n' : '';
      },
    });

    await sender.post_message_if_user?.({
      text: 'Build the launch map.',
      expected_user_id: 'U0EVAL',
    });

    expect(commands.filter(([command]) => command === 'goto')).toHaveLength(1);
    expect(commands.map(([command]) => command)).toEqual([
      'goto',
      'wait',
      'js',
      'fill',
      'wait',
      'press',
      'type',
      'press',
    ]);
  });

  it('does not post when the fixture identity is wrong', async () => {
    const commands: string[][] = [];
    const sender = create_slack_eval_sender({
      team_id: 'T0EVAL',
      channel_id: 'C0EVAL',
      run_browser_command: async (arguments_) => {
        commands.push(arguments_);
        return arguments_[0] === 'js' ? 'U0OTHER\n' : '';
      },
    });

    await expect(
      sender.post_message_if_user?.({
        text: 'Build the launch map.',
        expected_user_id: 'U0EVAL',
      }),
    ).rejects.toThrow('expected installer U0EVAL');
    expect(commands.some(([command]) => command === 'fill')).toBe(false);
  });

  it('rejects ambiguous Slack identities from a multi-account browser profile', async () => {
    const sender = create_slack_eval_sender({
      team_id: 'T0EVAL',
      channel_id: 'C0EVAL',
      run_browser_command: async (arguments_) => (arguments_[0] === 'js' ? 'U0EVAL,U0OTHER\n' : ''),
    });

    await expect(sender.get_user_id()).rejects.toThrow(
      'did not expose one unambiguous user identity',
    );
  });

  it('does not pass decrypted development secrets to the browser process', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slack-eval-env-'));
    const environment_path = join(directory, 'environment.txt');
    const browser_command = join(directory, 'browser-command');
    await writeFile(
      browser_command,
      `#!/bin/sh\n/usr/bin/env > '${environment_path}'\nprintf 'U0EVAL\\n'\n`,
    );
    await chmod(browser_command, 0o700);

    try {
      const sender = create_slack_eval_sender({
        team_id: 'T0EVAL',
        channel_id: 'C0EVAL',
        browser_command,
      });
      await expect(sender.get_user_id()).resolves.toBe('U0EVAL');
      const child_environment = await readFile(environment_path, 'utf8');

      expect(child_environment).not.toContain('DOTENV_PRIVATE_KEY_DEVELOPMENT=');
      expect(child_environment).not.toContain('SLACK_EVAL_ACTOR_PASSWORD=');
      expect(child_environment).toContain('HOME=');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not leak OAuth state from failed browser command arguments', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slack-eval-failure-'));
    const browser_command = join(directory, 'browser-command');
    const state_token = 'oauth-state-must-stay-secret';
    await writeFile(browser_command, '#!/bin/sh\nexit 17\n');
    await chmod(browser_command, 0o700);

    try {
      let failure: unknown;
      try {
        await create_browser_command(browser_command)([
          'newtab',
          `https://slack.com/oauth/v2/authorize?state=${state_token}`,
        ]);
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toHaveProperty('cause');
      expect(String(failure)).toContain('browser newtab command failed');
      expect(`${String(failure)} ${JSON.stringify(failure)}`).not.toContain(state_token);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

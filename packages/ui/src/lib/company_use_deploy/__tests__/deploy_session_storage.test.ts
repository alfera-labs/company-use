import {
  create_session,
  type DeploySession,
  forget_the_secrets_as_setup_opens,
  keep_the_secrets_after_the_first_report,
  read_server_without_its_link,
  read_session,
  save_session,
  secrets_kept_after_the_first_report_ms,
} from '@coworker/ui/lib/company_use_deploy/deploy_session';
import { screen_for_a_server_without_its_link } from '@coworker/ui/lib/company_use_deploy/remembered_deploy';
import { assert, beforeEach, describe, test } from 'vitest';

function browser_storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    all_text: () => [...values.values()].join('\n'),
  };
}

let local = browser_storage();

beforeEach(() => {
  local = browser_storage();
  Object.assign(globalThis, { localStorage: local });
});

const session = (): DeploySession =>
  create_session(
    { cloud: 'digitalocean', name: 'acme', backups: false },
    { version: 'v1.2.3', api_origin: 'https://api.example.test', test_overrides: null },
  );

describe('the deploy page storage', () => {
  test('keeps the session after the tab closes, so the person can come back', () => {
    const made = session();
    save_session(made);
    assert.deepEqual(read_session(), made);
  });

  test('deletes the tokens the moment the page opens the setup page', () => {
    const made = { ...session(), phase: 'opened' as const, opened_at: Date.now() };
    save_session(made);
    forget_the_secrets_as_setup_opens(made);

    assert.strictEqual(read_session(), null);
    assert.ok(!local.all_text().includes(made.setup_token));
    assert.ok(!local.all_text().includes(made.report_token));
    const screen = screen_for_a_server_without_its_link(read_server_without_its_link());
    assert.strictEqual(screen.name, 'choose');
  });

  test('treats the tokens as expired after an hour with no report', () => {
    const made = { ...session(), phase: 'making' as const, secrets_expire_at: Date.now() - 1 };
    save_session(made);

    assert.strictEqual(read_session(), null);
    assert.ok(!local.all_text().includes(made.setup_token));
    const screen = screen_for_a_server_without_its_link(read_server_without_its_link());
    assert.strictEqual(screen.name === 'problem' && screen.problem.action, 'start_again');
  });

  test('keeps the tokens 7 days once the server reports', () => {
    const made = session();
    save_session(made);
    keep_the_secrets_after_the_first_report(made.install_id);

    const left_ms = (read_session()?.secrets_expire_at ?? 0) - Date.now();
    assert.ok(left_ms > secrets_kept_after_the_first_report_ms - 60_000);
  });
});

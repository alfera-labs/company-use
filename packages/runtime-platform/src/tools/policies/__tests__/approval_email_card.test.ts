import {
  create_held_approval,
  read_sent_emails,
  stub_email_provider,
} from '@runtime-platform/tools/policies/__tests__/approval_fixture';
import { send_email_approval_card } from '@runtime-platform/tools/policies/approval_email_card';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('emailing an approval card', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('mails the deciders the ask, and ends with the words that answer it', async () => {
    const sent = stub_email_provider();
    const fixture = await create_held_approval();

    const delivered = await send_email_approval_card(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      wait: fixture.wait,
    });

    expect(delivered).toBe(1);
    const [body] = read_sent_emails(sent);
    expect(body?.to).toEqual([fixture.email]);
    expect(body?.subject).toContain('Approval needed:');
    expect(String(body?.text)).toContain('I need your OK to');
    expect(String(body?.text)).toContain(
      `\n\nReply YES to approve or NO to refuse.\nApproval ${fixture.wait.job_id}`,
    );
  });

  it('sends nothing when the wait names nobody who can decide', async () => {
    const sent = stub_email_provider();
    const fixture = await create_held_approval({ eligible: false });

    const delivered = await send_email_approval_card(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      wait: fixture.wait,
    });

    expect(delivered).toBe(0);
    expect(sent).not.toHaveBeenCalled();
  });
});

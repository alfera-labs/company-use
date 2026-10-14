import { AppError } from '@coworker/shared';
import type { WorkspaceVolumeAddress } from '@runtime-platform/files/workspace_volume_browser';
import { current_workspace_layout } from '@runtime-platform/storage/workspace_layouts';
import {
  create_held_approval,
  read_sent_emails,
  stub_email_provider,
} from '@runtime-platform/tools/policies/__tests__/approval_fixture';
import { send_approval_cards } from '@runtime-platform/tools/policies/approval_delivery';
import { afterEach, describe, expect, it, vi } from 'vitest';

const address: WorkspaceVolumeAddress = {
  volume_id: 'vol_test',
  provider_volume_id: 'pv_test',
  region: undefined,
  volume_workspace_path: 'agents/agt_test',
  layout: current_workspace_layout,
};

function policy_readers(file_text: string | null) {
  return {
    resolve_address: vi.fn(async () => address),
    read_file: vi.fn(async () => {
      if (file_text === null) {
        throw new AppError('workspace_file_not_found', 'That file no longer exists.', 404);
      }
      return new TextEncoder().encode(file_text);
    }),
  };
}

describe('delivering an approval card', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('falls to the next channel in the order when the first cannot reach anybody', async () => {
    const sent = stub_email_provider();
    const fixture = await create_held_approval();

    const delivered = await send_approval_cards(fixture.db, {
      workspace_id: fixture.bootstrap.workspace_id,
      wait: fixture.wait,
      policy_readers: policy_readers(null),
    });

    expect(delivered).toBe(1);
    expect(read_sent_emails(sent)[0]?.to).toEqual([fixture.email]);
  });
});

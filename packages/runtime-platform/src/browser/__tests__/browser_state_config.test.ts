import { create_browser_state_config } from '@runtime-platform/browser/browser_state_config';
import { describe, expect, it } from 'vitest';

describe('persistent browser state configuration', () => {
  it('derives a stable workspace key without exposing the master key', () => {
    const master_key = 'ab'.repeat(32);
    const first = create_browser_state_config({
      volume_id: 'vol_workspace_one',
      encryption_key: master_key,
      node_env: 'production',
    });
    const second = create_browser_state_config({
      volume_id: 'vol_workspace_one',
      encryption_key: master_key,
      node_env: 'production',
    });
    const other = create_browser_state_config({
      volume_id: 'vol_workspace_two',
      encryption_key: master_key,
      node_env: 'production',
    });

    expect(first).toEqual(second);
    expect(first.session_name).toBe('coworker_vol_workspace_one');
    expect(first.command_env.AGENT_BROWSER_RESTORE).toBe(first.session_name);
    expect(first.command_env.AGENT_BROWSER_ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.command_env.AGENT_BROWSER_ENCRYPTION_KEY).not.toBe(master_key);
    expect(other.command_env.AGENT_BROWSER_ENCRYPTION_KEY).not.toBe(
      first.command_env.AGENT_BROWSER_ENCRYPTION_KEY,
    );
  });

  it('fails loudly when production has no browser-state master key', () => {
    expect(() =>
      create_browser_state_config({
        volume_id: 'vol_workspace_one',
        encryption_key: '',
        node_env: 'production',
      }),
    ).toThrow('COWORKER_BROWSER_STATE_ENCRYPTION_KEY');
  });
});

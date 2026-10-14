import { keep_sandbox_alive_for } from '@runtime-platform/orchestrator/e2b_sandbox_client';
import { volume_sandbox_lifetime_ms } from '@runtime-platform/storage/volume_runtime';
import { describe, expect, it, vi } from 'vitest';

function fake_sandbox(minutes_left: number) {
  const getInfo = vi.fn(async () => ({
    endAt: new Date(Date.now() + minutes_left * 60_000),
  }));
  const setTimeout_ = vi.fn(async () => undefined);
  return {
    sandbox: { sandboxId: 'sbx_1', getInfo, setTimeout: setTimeout_ } as never,
    getInfo,
    set_timeout: setTimeout_,
  };
}

describe('keep_sandbox_alive_for', () => {
  it('leaves short commands alone rather than paying for a round trip', async () => {
    const { sandbox, getInfo, set_timeout } = fake_sandbox(1);

    await keep_sandbox_alive_for(sandbox, 120_000);

    expect(getInfo).not.toHaveBeenCalled();
    expect(set_timeout).not.toHaveBeenCalled();
  });

  it('extends a sandbox that would expire under a ten minute command', async () => {
    const { sandbox, set_timeout } = fake_sandbox(2);

    await keep_sandbox_alive_for(sandbox, 600_000);

    expect(set_timeout).toHaveBeenCalledWith(660_000);
  });

  it('never shortens a sandbox that already outlives the command', async () => {
    const { sandbox, set_timeout } = fake_sandbox(50);

    await keep_sandbox_alive_for(sandbox, 600_000);

    expect(set_timeout).not.toHaveBeenCalled();
  });

  it('stays inside the provider lifetime ceiling', async () => {
    const { sandbox, set_timeout } = fake_sandbox(1);

    await keep_sandbox_alive_for(sandbox, volume_sandbox_lifetime_ms);

    expect(set_timeout).toHaveBeenCalledWith(volume_sandbox_lifetime_ms);
  });

  it('lets the command run when the lifetime cannot be read', async () => {
    const sandbox = {
      sandboxId: 'sbx_1',
      getInfo: vi.fn(async () => {
        throw new Error('sandbox api unreachable');
      }),
      setTimeout: vi.fn(),
    } as never;

    await expect(keep_sandbox_alive_for(sandbox, 600_000)).resolves.toBeUndefined();
  });
});

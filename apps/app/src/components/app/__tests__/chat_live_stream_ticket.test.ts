import { afterEach, describe, expect, it, vi } from 'vitest';
import { get_live_stream_ticket } from '@/components/app/chat_live_stream_ticket';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the live stream ticket on a self-host', () => {
  it('is never asked from the API, so no chat makes a request that fails', async () => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);

    expect(await get_live_stream_ticket('ses_1')).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});

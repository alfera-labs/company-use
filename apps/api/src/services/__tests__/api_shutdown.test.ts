import { create_api_shutdown } from '@api/services/api_shutdown';
import { describe, expect, it, vi } from 'vitest';

describe('API shutdown', () => {
  it('waits for in-process event-job requests before exiting', async () => {
    let finish_server_close: () => void = () => undefined;
    let finish_request_persistence: () => void = () => undefined;
    const request_persisted = new Promise<void>((resolve) => {
      finish_request_persistence = resolve;
    });
    const exit_process = vi.fn();
    const shutdown = create_api_shutdown({
      close_server: (finished) => {
        finish_server_close = finished;
      },
      wait_for_event_job_requests: () => request_persisted,
      exit_process,
      force_exit_after_ms: 5_000,
    });

    const first_shutdown = shutdown();
    const repeated_shutdown = shutdown();
    finish_server_close();
    await Promise.resolve();
    expect(exit_process).not.toHaveBeenCalled();
    finish_request_persistence();
    await first_shutdown;

    expect(repeated_shutdown).toBe(first_shutdown);
    expect(exit_process).toHaveBeenCalledOnce();
    expect(exit_process).toHaveBeenCalledWith(0);
  });
});

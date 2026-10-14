import { report_unhandled_process_error } from '@api/lib/process_error_policy';
import { describe, expect, it, vi } from 'vitest';

function handlers(overrides: { is_abort_error: () => boolean }) {
  return {
    is_abort_error: overrides.is_abort_error,
    report: vi.fn(),
    log_warn: vi.fn(),
    log_error: vi.fn(),
  };
}

describe('report_unhandled_process_error', () => {
  it('ignores an expected abort from a cancelled run without reporting it', () => {
    const h = handlers({ is_abort_error: () => true });

    const decision = report_unhandled_process_error(
      new Error('the operation was aborted'),
      'unhandled_rejection',
      h,
    );

    expect(decision).toBe('ignored_abort');
    expect(h.report).not.toHaveBeenCalled();
    expect(h.log_error).not.toHaveBeenCalled();
  });

  it('reports an unhandled rejection and keeps serving — one run must not take down every tenant', () => {
    const h = handlers({ is_abort_error: () => false });

    const decision = report_unhandled_process_error(
      new Error('messages.6.content.1: unexpected tool_use_id in tool_result blocks'),
      'unhandled_rejection',
      h,
    );

    expect(decision).toBe('reported_continue');
    expect(h.report).toHaveBeenCalledOnce();
    expect(h.log_error).toHaveBeenCalledOnce();
  });

  it('reports an uncaught exception and asks the process to exit — sync state may be corrupt', () => {
    const h = handlers({ is_abort_error: () => false });

    const decision = report_unhandled_process_error(
      new Error('Cannot read properties of undefined (reading "foo")'),
      'uncaught_exception',
      h,
    );

    expect(decision).toBe('reported_exit');
    expect(h.report).toHaveBeenCalledOnce();
    expect(h.log_error).toHaveBeenCalledOnce();
  });
});

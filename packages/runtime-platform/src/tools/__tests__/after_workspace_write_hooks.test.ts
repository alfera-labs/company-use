import type { RuntimeToolResult } from '@agent-core/tools/runtime_tool_result';
import type { RunHookFailure } from '@runtime-platform/orchestrator/run_hook_attempt';
import {
  type AfterWorkspaceWriteHook,
  type AfterWorkspaceWriteInput,
  run_after_workspace_write_hooks,
} from '@runtime-platform/tools/after_workspace_write_hooks';
import { describe, expect, it } from 'vitest';

function write_input(result: RuntimeToolResult): AfterWorkspaceWriteInput {
  return {
    workspace_id: 'workspace_1',
    session_id: 'session_1',
    run_id: 'run_1',
    actor_id: 'actor_1',
    tool_name: 'write_file',
    tool_call_id: 'call_1',
    tool_input: {},
    environment: undefined,
    result,
  };
}

describe('run_after_workspace_write_hooks', () => {
  it('runs a run-bound hook after the fixed list, after the bytes land', async () => {
    const result = await run_after_workspace_write_hooks(
      [
        {
          hook_name: 'record_save',
          timeout_ms: 1_000,
          async run(input) {
            expect(input.result.ok).toBe(true);
            return { outcome: 'unchanged' };
          },
        },
      ],
      write_input({ ok: true, content_text: 'saved' }),
      undefined,
    );
    expect(result).toEqual({ ok: true, content_text: 'saved' });
  });

  it('lets a later hook see the result an earlier hook replaced', async () => {
    const seen_texts: Array<string | undefined> = [];
    const replace_hook: AfterWorkspaceWriteHook = {
      hook_name: 'replace',
      timeout_ms: 1_000,
      async run() {
        return { outcome: 'replaced_result', result: { ok: true, content_text: 'replaced' } };
      },
    };
    const observe_hook: AfterWorkspaceWriteHook = {
      hook_name: 'observe',
      timeout_ms: 1_000,
      async run(input) {
        seen_texts.push(input.result.ok ? input.result.content_text : undefined);
        return { outcome: 'unchanged' };
      },
    };
    await run_after_workspace_write_hooks(
      [replace_hook, observe_hook],
      write_input({ ok: true, content_text: 'original' }),
      undefined,
    );
    expect(seen_texts).toEqual(['replaced']);
  });

  it('keeps the previous result when a hook throws, and logs the failure instead of the model seeing it', async () => {
    const throwing_hook: AfterWorkspaceWriteHook = {
      hook_name: 'throws',
      timeout_ms: 1_000,
      async run() {
        throw new Error('disk is full');
      },
    };
    const result = await run_after_workspace_write_hooks(
      [throwing_hook],
      write_input({ ok: true, content_text: 'kept' }),
      undefined,
    );
    expect(result).toEqual({ ok: true, content_text: 'kept' });
  });

  it('lets a failed hook word its own failure into the result through result_after_failure', async () => {
    const wording_hook: AfterWorkspaceWriteHook = {
      hook_name: 'wording',
      timeout_ms: 1_000,
      async run() {
        return { outcome: 'failed', reason: 'quota exceeded' };
      },
      result_after_failure(_result, failure: RunHookFailure) {
        return {
          ok: false,
          error_code: 'after_write_hook_failed',
          error_message: failure_text(failure),
        };
      },
    };
    const result = await run_after_workspace_write_hooks(
      [wording_hook],
      write_input({ ok: true, content_text: 'original' }),
      undefined,
    );
    expect(result).toEqual({
      ok: false,
      error_code: 'after_write_hook_failed',
      error_message: 'quota exceeded',
    });
  });

  it('times a slow hook out and keeps the previous result', async () => {
    const slow_hook: AfterWorkspaceWriteHook = {
      hook_name: 'slow',
      timeout_ms: 5,
      async run() {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { outcome: 'replaced_result', result: { ok: true, content_text: 'too late' } };
      },
    };
    const result = await run_after_workspace_write_hooks(
      [slow_hook],
      write_input({ ok: true, content_text: 'kept' }),
      undefined,
    );
    expect(result).toEqual({ ok: true, content_text: 'kept' });
  });
});

function failure_text(failure: RunHookFailure) {
  return failure.failure === 'reported' ? failure.reason : failure.failure;
}

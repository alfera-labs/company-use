import type { ChatToolCall } from '@/components/app/chat_stream_projection';
import type { SandboxUrlPreview } from '@/lib/api';

const browser_live_view_kind = 'browser_live_view';

export function find_browser_live_view(previews: SandboxUrlPreview[]) {
  return previews.find((preview) => preview.preview_kind === browser_live_view_kind);
}

export function find_run_browser_live_view(
  previews: SandboxUrlPreview[],
  run_id: string | undefined,
  tool_calls: readonly Pick<ChatToolCall, 'run_id' | 'tool_name' | 'tool_status'>[],
  is_waiting_for_new_run = false,
) {
  if (is_waiting_for_new_run) return undefined;
  return run_used_browser(run_id, tool_calls) ? find_browser_live_view(previews) : undefined;
}

export function run_used_browser(
  run_id: string | undefined,
  tool_calls: readonly Pick<ChatToolCall, 'run_id' | 'tool_name' | 'tool_status'>[],
) {
  return Boolean(
    run_id &&
      tool_calls.some(
        (call) =>
          call.run_id === run_id &&
          ['browser', 'browse', 'agent-browser'].includes(call.tool_name) &&
          ['running', 'executing', 'completed', 'failed'].includes(call.tool_status),
      ),
  );
}

export function is_waiting_for_new_run(
  is_message_pending: boolean,
  run_id: string | undefined,
  run_id_before_send: string | undefined,
) {
  return is_message_pending && run_id === run_id_before_send;
}

export function without_browser_live_view(previews: SandboxUrlPreview[]) {
  return previews.filter((preview) => preview.preview_kind !== browser_live_view_kind);
}

export function browser_preview_poll_interval(
  is_runtime_active: boolean,
  is_message_pending: boolean,
  has_browser_preview: boolean,
  run_uses_browser: boolean,
) {
  if (!is_runtime_active && !is_message_pending) return false;
  if (!run_uses_browser) return false;
  return has_browser_preview ? 2000 : 500;
}

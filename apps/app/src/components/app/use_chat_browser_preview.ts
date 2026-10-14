import { useQuery } from '@tanstack/react-query';
import {
  browser_preview_poll_interval,
  find_browser_live_view,
  find_run_browser_live_view,
  is_waiting_for_new_run,
  run_used_browser,
} from '@/components/app/chat_browser_panel';
import type { ChatToolCall } from '@/components/app/chat_stream_projection';
import { list_session_sandbox_url_previews } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

/** Reads the sandbox previews of a chat and picks the browser live view of the newest run. */
export function useChatBrowserPreview(input: {
  session_id: string | undefined;
  latest_run_id: string | undefined;
  run_id_before_send: string | undefined;
  is_runtime_active: boolean;
  is_send_pending: boolean;
  visible_tool_calls: ChatToolCall[];
}) {
  const { session_id, latest_run_id, visible_tool_calls } = input;
  const sandbox_previews_query = useQuery({
    enabled: Boolean(session_id),
    queryFn: () => list_session_sandbox_url_previews(session_id ?? ''),
    queryKey: query_keys.sandbox_previews(session_id),
    refetchInterval: (query) =>
      browser_preview_poll_interval(
        input.is_runtime_active,
        input.is_send_pending,
        Boolean(find_browser_live_view(query.state.data ?? [])),
        run_used_browser(latest_run_id, visible_tool_calls),
      ),
  });
  const waiting_for_new_run = is_waiting_for_new_run(
    input.is_send_pending,
    latest_run_id,
    input.run_id_before_send,
  );
  const sandbox_previews = sandbox_previews_query.data ?? [];
  const browser_preview = find_run_browser_live_view(
    sandbox_previews,
    latest_run_id,
    visible_tool_calls,
    waiting_for_new_run,
  );
  return { sandbox_previews, waiting_for_new_run, browser_preview };
}

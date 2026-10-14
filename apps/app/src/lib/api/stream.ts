import { ApiError, api_fetch, session_by_id_client } from '@/lib/api/client';
import { read_sse_frames_from_response_body, type SseFrame } from '@/lib/api/sse_frames';
import type { AgentRunStreamEvent, SessionMessagePayload } from '@/lib/api/types';

export async function stream_session_message(
  session_id: string,
  payload: SessionMessagePayload,
  on_event: (event: AgentRunStreamEvent) => void,
  options: { signal?: AbortSignal } = {},
) {
  const url = session_by_id_client.messages.stream.$url({ param: { session_id } });
  const response = await fetch_stream_response(url, payload, options);
  if (!response) return;

  if (!response.ok) throw new Error(`POST ${url.pathname} failed (${response.status})`);
  if (!response.body) throw new Error(`POST ${url.pathname} did not return a stream`);

  try {
    await read_sse_frames_from_response_body(response.body, (frame) =>
      dispatch_sse_frame(frame, on_event),
    );
  } catch (error) {
    if (options.signal?.aborted) return;
    throw error;
  }
}

async function fetch_stream_response(
  url: URL,
  payload: SessionMessagePayload,
  options: { signal?: AbortSignal },
) {
  try {
    return await api_fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (options.signal?.aborted) return null;
    throw error;
  }
}

function dispatch_sse_frame(frame: SseFrame, on_event: (event: AgentRunStreamEvent) => void) {
  const parsed_event = JSON.parse(frame.data) as Record<string, unknown>;
  const event = (
    typeof parsed_event.type === 'string' || !frame.event_name
      ? parsed_event
      : { ...parsed_event, type: frame.event_name }
  ) as AgentRunStreamEvent;
  on_event(event);
  if (event.type === 'error') {
    const code = typeof parsed_event.code === 'string' ? parsed_event.code : null;
    throw new ApiError(event.message, code === 'stream_error' || !code ? 500 : 402, code);
  }
}

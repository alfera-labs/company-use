import { live_stream_unavailable_reason } from '@/components/app/chat_live_socket_state';

export function report_live_socket_fallback(reason: string) {
  if (reason === live_stream_unavailable_reason) return;
  console.warn(`[chat live socket] using the per-run stream and polls: ${reason}`);
}

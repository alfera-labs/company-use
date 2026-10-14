/**
 * The browser of a self-host can not reach the queue engine, so this build offers no live
 * stream and asks the API for no ticket. The chat reads the per-run stream.
 */
export function get_live_stream_ticket(_session_id: string): Promise<null> {
  return Promise.resolve(null);
}

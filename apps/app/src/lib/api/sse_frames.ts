export type SseFrame = {
  event_name: string | null;
  event_id: string | null;
  data: string;
};

export async function read_sse_frames_from_response_body(
  body: ReadableStream<Uint8Array>,
  on_frame: (frame: SseFrame) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    buffer = read_complete_sse_frames(buffer, on_frame);
  }

  buffer += decoder.decode();
  read_complete_sse_frames(`${buffer}\n\n`, on_frame);
}

function read_complete_sse_frames(buffer: string, on_frame: (frame: SseFrame) => void) {
  let remaining = buffer;
  let boundary = remaining.indexOf('\n\n');

  while (boundary !== -1) {
    const frame = read_sse_frame(remaining.slice(0, boundary));
    remaining = remaining.slice(boundary + 2);
    if (frame) on_frame(frame);
    boundary = remaining.indexOf('\n\n');
  }

  return remaining;
}

function read_sse_frame(raw_frame: string): SseFrame | null {
  if (!raw_frame.trim()) return null;

  const data_lines: string[] = [];
  let event_name: string | null = null;
  let event_id: string | null = null;
  for (const line of raw_frame.split(/\r?\n/u)) {
    if (line.startsWith('event:')) event_name = line.slice(6).trim();
    if (line.startsWith('id:')) event_id = line.slice(3).trim();
    if (line.startsWith('data:')) data_lines.push(line.slice(5).trimStart());
  }

  if (data_lines.length === 0) return null;

  return { event_name, event_id, data: data_lines.join('\n') };
}

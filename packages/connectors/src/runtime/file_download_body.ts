type StreamReader = ReadableStreamDefaultReader<Uint8Array>;

export type CappedBodyResult = { outcome: 'ok'; bytes: Uint8Array } | { outcome: 'too_large' };

async function read_chunks_within_cap(
  reader: StreamReader,
  max_bytes: number,
  chunks: Uint8Array[],
  total_bytes: number,
): Promise<Uint8Array[] | null> {
  const { done, value } = await reader.read();
  if (done) return chunks;
  const next_total_bytes = total_bytes + value.byteLength;
  if (next_total_bytes > max_bytes) {
    await reader.cancel();
    return null;
  }
  chunks.push(value);
  return read_chunks_within_cap(reader, max_bytes, chunks, next_total_bytes);
}

function concatenate_chunks(chunks: readonly Uint8Array[]) {
  const total_bytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const combined = new Uint8Array(total_bytes);
  chunks.reduce((offset, chunk) => {
    combined.set(chunk, offset);
    return offset + chunk.byteLength;
  }, 0);
  return combined;
}

function declares_too_many_bytes(response: Response, max_bytes: number) {
  const content_length = response.headers.get('content-length');
  return content_length !== null && Number(content_length) > max_bytes;
}

export async function discard_response_body(response: Response) {
  if (response.body) await response.body.cancel();
}

export async function read_capped_body(
  response: Response,
  max_bytes: number,
): Promise<CappedBodyResult> {
  if (declares_too_many_bytes(response, max_bytes)) {
    await discard_response_body(response);
    return { outcome: 'too_large' };
  }
  const reader = response.body?.getReader();
  if (!reader) return { outcome: 'ok', bytes: new Uint8Array(0) };
  const chunks = await read_chunks_within_cap(reader, max_bytes, [], 0);
  if (chunks === null) return { outcome: 'too_large' };
  return { outcome: 'ok', bytes: concatenate_chunks(chunks) };
}

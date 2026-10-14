/**
 * The version of a downloaded file: the SHA-256 the API sends in the ETag header. A browser
 * offers `crypto.subtle` only on https and on localhost, so the header comes first and the
 * local digest is only for an API that does not send it.
 */
export async function read_file_content_version(
  response_headers: Headers,
  bytes: ArrayBuffer,
): Promise<string> {
  const from_header = response_headers.get('etag')?.replace(/^"|"$/gu, '');
  if (from_header) return from_header;
  if (!globalThis.crypto.subtle) {
    throw new Error('This file has no version to open it with. Update the API and try again.');
  }
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

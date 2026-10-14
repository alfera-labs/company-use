const address_usually_ends_in_mcp = 'For most servers the address ends in /mcp.';

/** What a server said, as far as the words need it: the status, and the body with its kind. */
export type McpAnswer = { status: number; content_type: string | null; body: string };

/** Reads what a server said. A body that cannot be read counts as an empty one. */
export async function read_mcp_answer(response: Response): Promise<McpAnswer> {
  return {
    status: response.status,
    content_type: response.headers.get('content-type'),
    body: await response.text().catch(() => ''),
  };
}

const statuses_of_a_web_server_that_does_not_support_the_method = new Set([405, 501]);

/** True when the body is a web page: by what the server calls it, or by how it starts. */
export function is_a_web_page(answer: Pick<McpAnswer, 'content_type' | 'body'>): boolean {
  if ((answer.content_type ?? '').toLowerCase().includes('text/html')) return true;
  return /^\s*(<!doctype html|<html[\s>])/i.test(answer.body);
}

/**
 * What a person reads for an answer that is not the answer of an MCP server, not a redirect and
 * not a refused credential: what most likely went wrong, and what to try. The answer decides,
 * not the status alone: a plain web server says "web page" in its body, or says that it does
 * not support the method, under any status. A wrong path keeps its own sentence, because an
 * MCP server answers a wrong path with a page too.
 */
export function words_for_mcp_answer(answer: McpAnswer): string {
  const { status } = answer;
  if (status === 404) {
    return `Nothing answers as an MCP server at that address (HTTP 404). Check the end of the address. ${address_usually_ends_in_mcp}`;
  }
  if (
    statuses_of_a_web_server_that_does_not_support_the_method.has(status) ||
    is_a_web_page(answer)
  ) {
    return `That address is a web page, not an MCP server (HTTP ${status}). Give the address of the MCP server itself. ${address_usually_ends_in_mcp}`;
  }
  if (status >= 500) {
    return `The MCP server failed on its own side (HTTP ${status}). Try again in a minute. If it fails again, the people who run the server must look at it.`;
  }
  return `That address did not answer as an MCP server does (HTTP ${status}). Check the address. ${address_usually_ends_in_mcp}`;
}

const words_by_error_name: Record<string, string> = {
  TimeoutError:
    'The MCP server did not answer in time. Check that the server is running, then try again.',
  AbortError: 'The request to the MCP server was stopped before the server answered.',
};

/** What a person reads when a request got no answer: a wrong name, a server that is down. */
export function words_for_no_mcp_answer(error: unknown): string {
  const error_name = error instanceof Error ? error.name : '';
  return (
    words_by_error_name[error_name] ??
    'Alfera could not connect to that address. Check the spelling of the address and that the server is running, then try again.'
  );
}

/**
 * What a person reads when the server refuses a credential, by what was sent. `stored_credential`
 * is for a sync or a tool call long after the add. The other three are for the add itself: the
 * key went as a bearer token, the key went under a header the person named, or no key went.
 */
export const mcp_credential_refusal_words = {
  stored_credential:
    'The MCP server refused the key or the sign-in it was sent. Reconnect the server with a key that works.',
  key_as_a_token:
    'The server did not accept this key. Check that the whole key was pasted. If the server wants the key under a header name, such as X-API-Key, fill in the header name, then add it again.',
  key_in_a_header:
    'The server did not accept this key. Check the key and the header name: both must be exactly what the server asks for. If the server names no header, leave the header name empty, then add it again.',
  no_key_given:
    'This server asks for a key or a sign-in, and it was sent none. Give its key, or choose a sign-in, then add it again.',
};

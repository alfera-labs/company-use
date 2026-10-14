import { find_mcp_request_header_refusal } from '@coworker/shared';
import {
  type McpServerDraft,
  sends_api_key_in_a_named_header,
} from '@/components/app/use_mcp_server_addition';

/**
 * The sentence for a header name that Alfera sets itself, or null. The API refuses the same
 * names with the same sentence; the dialog says it before the person presses Add server.
 */
export function find_mcp_header_refusal(draft: McpServerDraft): string | null {
  return find_mcp_request_header_refusal([
    ...(sends_api_key_in_a_named_header(draft) ? [draft.api_key_header_name] : []),
    ...draft.request_headers.map((header) => header.name),
  ]);
}

/** True when closing the dialog would throw away a key, a secret or a header the person typed. */
export function holds_a_typed_credential(draft: McpServerDraft): boolean {
  const typed = [
    draft.api_key,
    draft.oauth_client_id,
    draft.oauth_client_secret,
    ...draft.request_headers.flatMap((header) => [header.name, header.value]),
  ];
  return typed.some((value) => value.trim().length > 0);
}

export function can_add_mcp_server(draft: McpServerDraft): boolean {
  if (find_mcp_header_refusal(draft)) return false;
  return draft.authentication !== 'api_key' || draft.api_key.trim().length > 0;
}

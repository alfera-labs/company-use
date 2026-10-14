// biome-ignore-all lint/correctness/useHookAtTopLevel: repository hook names use snake_case.

import { format_error_message } from '@coworker/shared';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { add_mcp_server, inspect_mcp_server } from '@/lib/api';
import type { AddedMcpServer, InspectedMcpServer, McpAuthenticationMode } from '@/lib/api/types';

export type McpOAuthClientMode = 'automatic' | 'own';

/** How the person gives the server a credential: one of its sign-in modes, or a key they hold. */
export type McpCredentialChoice = McpAuthenticationMode | 'api_key';

export type McpRequestHeaderDraft = { name: string; value: string };

export type McpServerDraft = {
  display_name: string;
  server_url: string;
  authentication: McpCredentialChoice;
  oauth_client_mode: McpOAuthClientMode;
  oauth_client_id: string;
  oauth_client_secret: string;
  api_key: string;
  api_key_header_name: string;
  request_headers: McpRequestHeaderDraft[];
};

export const max_mcp_request_headers = 4;

const empty_draft: McpServerDraft = {
  display_name: '',
  server_url: '',
  authentication: 'always',
  oauth_client_mode: 'automatic',
  oauth_client_id: '',
  oauth_client_secret: '',
  api_key: '',
  api_key_header_name: '',
  request_headers: [{ name: '', value: '' }],
};

export function use_mcp_server_addition(input: { on_close: () => void; on_added: () => void }) {
  const [draft, set_draft] = useState<McpServerDraft>(empty_draft);
  const [inspected, set_inspected] = useState<InspectedMcpServer | null>(null);
  const [added, set_added] = useState<AddedMcpServer | null>(null);
  const { inspect, add } = use_inspect_and_add_requests(draft, {
    on_inspected: (result) => {
      set_inspected(result);
      set_draft((current) => start_draft_on_what_the_server_points_to(current, result));
    },
    on_added: (result) => {
      set_added(result);
      input.on_added();
    },
  });

  const { on_close } = input;
  const forget_refusals = use_refusal_reset(inspect.reset, add.reset);
  const reset_and_close = useCallback(() => {
    set_draft(empty_draft);
    set_inspected(null);
    set_added(null);
    forget_refusals({ of_the_address: true });
    on_close();
  }, [on_close, forget_refusals]);

  return {
    draft,
    inspected,
    added,
    is_inspecting: inspect.isPending,
    is_adding: add.isPending,
    address_refusal: read_refusal(inspect.error, refusal_fallbacks.address),
    add_refusal: read_refusal(add.error, refusal_fallbacks.add),
    change: (fields: Partial<McpServerDraft>) => {
      forget_refusals({ of_the_address: fields.server_url !== undefined });
      set_draft((current) => ({ ...current, ...fields }));
    },
    inspect: () => inspect.mutate(),
    step_back: () => {
      forget_refusals({ of_the_address: false });
      set_inspected(null);
    },
    submit: () => add.mutate(),
    reset_and_close,
  };
}

function use_inspect_and_add_requests(
  draft: McpServerDraft,
  handlers: {
    on_inspected: (result: InspectedMcpServer) => void;
    on_added: (result: AddedMcpServer) => void;
  },
) {
  const inspect = useMutation({
    mutationFn: () => inspect_mcp_server({ server_url: draft.server_url.trim() }),
    onSuccess: handlers.on_inspected,
  });
  const add = useMutation({
    mutationFn: () => add_mcp_server(read_mcp_server_draft(draft)),
    onSuccess: handlers.on_added,
  });
  return { inspect, add };
}

const refusal_fallbacks = {
  address: 'Alfera could not reach that server. Check the address, then try again.',
  add: 'Alfera could not add that server. Check what you entered, then try again.',
};

function read_refusal(error: unknown, fallback: string): string | null {
  return error ? format_error_message(error, fallback) : null;
}

function use_refusal_reset(forget_address_refusal: () => void, forget_add_refusal: () => void) {
  return useCallback(
    (which: { of_the_address: boolean }) => {
      if (which.of_the_address) forget_address_refusal();
      forget_add_refusal();
    },
    [forget_address_refusal, forget_add_refusal],
  );
}

function start_draft_on_what_the_server_points_to(
  draft: McpServerDraft,
  inspected: InspectedMcpServer,
): McpServerDraft {
  return {
    ...draft,
    authentication: pick_credential_choice(inspected),
    oauth_client_mode: inspected.supports_dynamic_registration ? 'automatic' : 'own',
    display_name: draft.display_name || (inspected.server_name ?? ''),
  };
}

/**
 * The choice the server itself points to: the dialog starts on it and marks it as detected. A
 * server that asks for a credential and publishes no sign-in takes a key or a token, so a
 * sign-in the server does not offer is never the one.
 */
export function pick_credential_choice(inspected: InspectedMcpServer): McpCredentialChoice {
  if (inspected.offers_sign_in || inspected.authentication === 'none') {
    return inspected.authentication;
  }
  return inspected.authentication === 'always' ? 'api_key' : 'none';
}

/** True when the key goes under a header the person named, and not as a bearer token. */
export function sends_api_key_in_a_named_header(draft: McpServerDraft): boolean {
  return draft.authentication === 'api_key' && draft.api_key_header_name.trim().length > 0;
}

/** A key in a named header is one of the headers the server is sent, so it takes one row. */
export function count_free_mcp_header_rows(draft: McpServerDraft): number {
  return max_mcp_request_headers - (sends_api_key_in_a_named_header(draft) ? 1 : 0);
}

/** What the API is sent. A key goes as a bearer token unless the person named a header for it. */
export function read_mcp_server_draft(draft: McpServerDraft) {
  const display_name = draft.display_name.trim();
  const gives_a_key = draft.authentication === 'api_key';
  const signs_in = draft.authentication === 'always' || draft.authentication === 'when_asked';
  const api_key = draft.api_key.trim();
  const client_id = draft.oauth_client_id.trim();
  const client_secret = draft.oauth_client_secret.trim();
  const request_headers = [
    ...(sends_api_key_in_a_named_header(draft)
      ? [{ name: draft.api_key_header_name, value: api_key }]
      : []),
    ...draft.request_headers.slice(0, count_free_mcp_header_rows(draft)),
  ]
    .map((header) => ({ name: header.name.trim(), value: header.value.trim() }))
    .filter((header) => header.name.length > 0 && header.value.length > 0);

  return {
    server_url: draft.server_url.trim(),
    authentication: draft.authentication === 'api_key' ? ('none' as const) : draft.authentication,
    ...(display_name ? { display_name } : {}),
    ...(gives_a_key && !sends_api_key_in_a_named_header(draft) ? { access_token: api_key } : {}),
    ...(signs_in && draft.oauth_client_mode === 'own' && client_id
      ? { oauth_client: { client_id, ...(client_secret ? { client_secret } : {}) } }
      : {}),
    ...(request_headers.length > 0 ? { request_headers } : {}),
  };
}

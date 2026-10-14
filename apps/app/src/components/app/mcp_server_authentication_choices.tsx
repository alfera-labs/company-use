import { ChoiceRow, LabelledField } from '@/components/app/mcp_server_choice_fields';
import {
  type McpCredentialChoice,
  type McpServerDraft,
  pick_credential_choice,
} from '@/components/app/use_mcp_server_addition';
import type { InspectedMcpServer } from '@/lib/api/types';

export function McpServerAuthenticationChoices({
  draft,
  inspected,
  on_change,
}: {
  draft: McpServerDraft;
  inspected: InspectedMcpServer;
  on_change: (fields: Partial<McpServerDraft>) => void;
}) {
  const detected = pick_credential_choice(inspected);
  const choice = (value: McpCredentialChoice) => ({
    badge: detected === value ? 'Detected' : undefined,
    name: 'mcp-authentication',
    selected: draft.authentication,
    value,
    on_select: (authentication: McpCredentialChoice) => on_change({ authentication }),
  });

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Sign-in to this server</legend>
      <ChoiceRow
        {...choice('always')}
        description="Everyone signs in on the server's own page before using its tools."
        title="Each person signs in"
      />
      <ChoiceRow
        {...choice('when_asked')}
        description="Connect now with no sign-in. For a server with some tools that need no account."
        title="Sign in only when the server asks"
      />
      <ChoiceRow
        {...choice('api_key')}
        description="Paste the key the server gave you. It is stored encrypted and never shown again."
        title="I have an API key or token"
      >
        <ApiKeyFields draft={draft} on_change={on_change} />
      </ChoiceRow>
      <ChoiceRow
        {...choice('none')}
        description="For a server that anyone may use."
        title="No sign-in and no key"
      />
    </fieldset>
  );
}

function ApiKeyFields({
  draft,
  on_change,
}: {
  draft: McpServerDraft;
  on_change: (fields: Partial<McpServerDraft>) => void;
}) {
  return (
    <>
      <LabelledField
        id="mcp-api-key"
        label="API key or token"
        placeholder="Paste the key or token"
        secret
        value={draft.api_key}
        on_change={(api_key) => on_change({ api_key })}
      />
      <LabelledField
        hint="Leave empty unless the server names a header for the key, such as X-API-Key."
        id="mcp-api-key-header-name"
        label="Header name (optional)"
        placeholder="X-API-Key"
        value={draft.api_key_header_name}
        on_change={(api_key_header_name) => on_change({ api_key_header_name })}
      />
    </>
  );
}

import { ChoiceRow, LabelledField } from '@/components/app/mcp_server_choice_fields';
import type { McpOAuthClientMode, McpServerDraft } from '@/components/app/use_mcp_server_addition';
import type { InspectedMcpServer } from '@/lib/api/types';

/** For a server people sign in to: how the server knows Alfera, which is its OAuth client. */
export function McpServerAppRegistrationChoices({
  draft,
  inspected,
  on_change,
}: {
  draft: McpServerDraft;
  inspected: InspectedMcpServer;
  on_change: (fields: Partial<McpServerDraft>) => void;
}) {
  const choice = (value: McpOAuthClientMode) => ({
    name: 'mcp-oauth-client',
    selected: draft.oauth_client_mode,
    value,
    on_select: (oauth_client_mode: McpOAuthClientMode) => on_change({ oauth_client_mode }),
  });

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">How the server knows Alfera</legend>
      <ChoiceRow
        {...choice('automatic')}
        badge={inspected.supports_dynamic_registration ? 'Detected' : undefined}
        description="Nothing to set up. Works with most servers."
        title="Alfera registers itself"
      />
      <ChoiceRow
        {...choice('own')}
        description="For a server that does not let Alfera register itself. Paste what the server gave you for the app."
        title="Use an app I registered with the server"
      >
        <LabelledField
          hint="The public ID of the app. Not an API key."
          id="mcp-oauth-client-id"
          label="Client ID"
          value={draft.oauth_client_id}
          on_change={(oauth_client_id) => on_change({ oauth_client_id })}
        />
        <LabelledField
          hint="Only if the server gave you one. It is stored encrypted."
          id="mcp-oauth-client-secret"
          label="Client secret (optional)"
          secret
          value={draft.oauth_client_secret}
          on_change={(oauth_client_secret) => on_change({ oauth_client_secret })}
        />
      </ChoiceRow>
    </fieldset>
  );
}

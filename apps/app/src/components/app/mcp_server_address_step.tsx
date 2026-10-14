import { Button } from '@coworker/ui/components/button';
import { LabelledField } from '@/components/app/mcp_server_choice_fields';
import type { McpServerDraft } from '@/components/app/use_mcp_server_addition';

export function McpServerAddressStep({
  draft,
  pending,
  refusal,
  on_change,
  on_cancel,
  on_continue,
}: {
  draft: McpServerDraft;
  pending: boolean;
  refusal: string | null;
  on_change: (fields: Partial<McpServerDraft>) => void;
  on_cancel: () => void;
  on_continue: () => void;
}) {
  const can_continue = draft.server_url.trim().length > 0 && !pending;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (can_continue) on_continue();
      }}
    >
      <AddressStepIntroduction />

      <LabelledField
        hint="Shown in your workspace. Leave it out and the server is asked what it calls itself."
        id="mcp-display-name"
        label="Name"
        value={draft.display_name}
        on_change={(display_name) => on_change({ display_name })}
      />
      <LabelledField
        hint="The full address of the server. It usually ends in /mcp."
        id="mcp-server-url"
        label="Server URL"
        placeholder="https://mcp.example.com/mcp"
        refusal={refusal}
        value={draft.server_url}
        on_change={(server_url) => on_change({ server_url })}
      />

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={on_cancel}>
          Cancel
        </Button>
        <Button disabled={!can_continue} type="submit">
          {pending ? 'Checking...' : 'Continue'}
        </Button>
      </div>
    </form>
  );
}

function AddressStepIntroduction() {
  return (
    <div className="space-y-1">
      <div className="text-base font-medium">Add MCP server</div>
      <p className="text-sm text-muted-foreground">
        Paste the address of an MCP server and its tools become available to your coworker. If the
        server needs an API key, you give it in the next step.
      </p>
    </div>
  );
}

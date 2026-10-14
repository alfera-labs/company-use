import { Button } from '@coworker/ui/components/button';
import { McpServerAppRegistrationChoices } from '@/components/app/mcp_server_app_registration_choices';
import { McpServerAuthenticationChoices } from '@/components/app/mcp_server_authentication_choices';
import { RequestHeaderRows } from '@/components/app/mcp_server_choice_fields';
import {
  can_add_mcp_server,
  find_mcp_header_refusal,
} from '@/components/app/mcp_server_draft_checks';
import type { CloseQuestion } from '@/components/app/use_close_question';
import {
  count_free_mcp_header_rows,
  type McpServerDraft,
} from '@/components/app/use_mcp_server_addition';
import type { InspectedMcpServer } from '@/lib/api/types';

export function McpServerOptionsStep({
  draft,
  inspected,
  pending,
  refusal,
  closing,
  on_change,
  on_back,
  on_submit,
}: {
  draft: McpServerDraft;
  inspected: InspectedMcpServer;
  pending: boolean;
  refusal: string | null;
  closing: CloseQuestion;
  on_change: (fields: Partial<McpServerDraft>) => void;
  on_back: () => void;
  on_submit: () => void;
}) {
  const can_submit = can_add_mcp_server(draft) && !pending;
  const signs_in = draft.authentication === 'always' || draft.authentication === 'when_asked';

  return (
    <form
      className="flex max-h-[calc(100vh-4.5rem)] flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (can_submit && !closing.is_asking) on_submit();
      }}
    >
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <div className="space-y-1">
          <div className="text-base font-medium">
            {draft.display_name.trim() || 'Add MCP server'}
          </div>
          <p className="font-mono text-xs break-all text-muted-foreground">
            {inspected.endpoint_url}
          </p>
        </div>

        <McpServerAuthenticationChoices draft={draft} inspected={inspected} on_change={on_change} />

        {signs_in ? (
          <McpServerAppRegistrationChoices
            draft={draft}
            inspected={inspected}
            on_change={on_change}
          />
        ) : null}

        <MoreOptions draft={draft} on_change={on_change} />
      </div>

      {closing.is_asking ? (
        <CloseQuestionRow on_close={closing.close} on_keep_editing={closing.keep_editing} />
      ) : (
        <OptionsStepFooter
          can_submit={can_submit}
          pending={pending}
          refusal={find_mcp_header_refusal(draft) ?? refusal}
          on_back={on_back}
        />
      )}
    </form>
  );
}

function MoreOptions({
  draft,
  on_change,
}: {
  draft: McpServerDraft;
  on_change: (fields: Partial<McpServerDraft>) => void;
}) {
  const free_header_rows = count_free_mcp_header_rows(draft);
  const headers_given = draft.request_headers.filter((header) => header.name.trim()).length;

  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer text-sm text-foreground">
        More options{headers_given > 0 ? ` (${headers_given} set)` : ''}
      </summary>
      <div className="mt-3 space-y-2">
        <div className="text-sm font-medium text-foreground">Additional request headers</div>
        <p>
          Sent on every request to this server. Values are stored encrypted and never shown again.
          You can add up to {free_header_rows}.
        </p>
        <RequestHeaderRows
          headers={draft.request_headers.slice(0, free_header_rows)}
          maximum={free_header_rows}
          on_change={(request_headers) => on_change({ request_headers })}
        />
        <p className="pt-2">
          For the technical: Alfera connects over Streamable HTTP, so give the address that ends in
          /mcp, not the older /sse one. Sign-in is OAuth.
        </p>
      </div>
    </details>
  );
}

function OptionsStepFooter({
  can_submit,
  pending,
  refusal,
  on_back,
}: {
  can_submit: boolean;
  pending: boolean;
  refusal: string | null;
  on_back: () => void;
}) {
  return (
    <>
      {refusal ? (
        <p className="text-sm text-destructive" role="alert">
          {refusal}
        </p>
      ) : null}
      <div className="flex shrink-0 justify-end gap-2 border-t pt-3">
        <Button type="button" variant="outline" onClick={on_back}>
          Back
        </Button>
        <Button disabled={!can_submit} type="submit">
          {pending ? 'Adding...' : 'Add server'}
        </Button>
      </div>
    </>
  );
}

function CloseQuestionRow({
  on_keep_editing,
  on_close,
}: {
  on_keep_editing: () => void;
  on_close: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-col gap-3 border-t pt-3">
      <p className="text-sm" role="alert">
        Close without adding this server? What you typed is not saved.
      </p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={on_close}>
          Close without adding
        </Button>
        <Button autoFocus type="button" onClick={on_keep_editing}>
          Keep editing
        </Button>
      </div>
    </div>
  );
}

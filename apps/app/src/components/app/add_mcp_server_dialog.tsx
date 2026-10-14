import { AlertDialog, AlertDialogContent } from '@coworker/ui/components/alert-dialog';
import { Button, buttonVariants } from '@coworker/ui/components/button';
import { ExternalLink } from 'lucide-react';
import { McpServerAddressStep } from '@/components/app/mcp_server_address_step';
import { holds_a_typed_credential } from '@/components/app/mcp_server_draft_checks';
import { McpServerOptionsStep } from '@/components/app/mcp_server_options_step';
import { use_close_question } from '@/components/app/use_close_question';
import { use_mcp_server_addition } from '@/components/app/use_mcp_server_addition';
import type { AddedMcpServer } from '@/lib/api/types';

export function AddMcpServerDialog({
  open,
  on_open_change,
  on_added,
}: {
  open: boolean;
  on_open_change: (open: boolean) => void;
  on_added: () => void;
}) {
  const addition = use_mcp_server_addition({ on_close: () => on_open_change(false), on_added });
  const closing = use_close_question({
    would_lose_what_was_typed:
      Boolean(addition.inspected) && !addition.added && holds_a_typed_credential(addition.draft),
    close: addition.reset_and_close,
  });

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => (next ? on_open_change(true) : closing.close_or_ask_first())}
    >
      <AlertDialogContent className="max-w-md">
        {addition.added ? (
          <AddedMcpServerResult added={addition.added} on_done={closing.close} />
        ) : addition.inspected ? (
          <McpServerOptionsStep
            draft={addition.draft}
            inspected={addition.inspected}
            pending={addition.is_adding}
            refusal={addition.add_refusal}
            closing={closing}
            on_back={addition.step_back}
            on_change={addition.change}
            on_submit={addition.submit}
          />
        ) : (
          <McpServerAddressStep
            draft={addition.draft}
            pending={addition.is_inspecting}
            refusal={addition.address_refusal}
            on_cancel={closing.close}
            on_change={addition.change}
            on_continue={addition.inspect}
          />
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function added_tools_words(tool_count: number): string {
  if (tool_count === 0) return 'The server lists no tools yet, so your coworker has none to use.';
  if (tool_count === 1) {
    return '1 tool added. Your coworker can use it now: ask for what you need.';
  }
  return `${tool_count} tools added. Your coworker can use them now: ask for what you need and it finds the right one.`;
}

function AddedMcpServerResult({ added, on_done }: { added: AddedMcpServer; on_done: () => void }) {
  if (added.kind === 'connected') {
    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <div className="text-base font-medium">{added.app_name} is ready</div>
          <p className="text-sm text-muted-foreground">
            {added_tools_words(added.tool_count)} The server is under Connected on this page, where
            you can see its tools or remove it.
          </p>
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={on_done}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <div className="text-base font-medium">Sign in to {added.app_name}</div>
        <p className="text-sm text-muted-foreground">
          This server needs your permission. Sign in and it appears under Connected on this page,
          with its tools.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={on_done}>
          Later
        </Button>
        <a
          className={buttonVariants({ variant: 'default' })}
          href={added.start_url}
          rel="noreferrer"
          target="_blank"
        >
          <ExternalLink className="size-3.5" />
          Sign in
        </a>
      </div>
    </div>
  );
}

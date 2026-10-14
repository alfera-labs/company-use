import { Button } from '@coworker/ui/components/button';
import { Code2, Globe, Plug, Plus } from 'lucide-react';
import { AppCatalogueSetupChoices } from '@/components/app/app_catalogue_setup_choices';
import { use_is_plain_team_member } from '@/components/app/use_team_mode';
import { useSavedCredentialsReachTheSandbox } from '@/lib/use_install_has_app_catalogue';

export type ConnectAnythingKind = 'mcp' | 'api' | 'website';

type ConnectAnythingRowRecord = {
  kind: ConnectAnythingKind;
  name: string;
  icon: typeof Plug;
  saves_a_credential_for_the_sandbox: boolean;
  what_it_is_for?: string;
  a_plain_team_member_reads?: string;
};

const connect_anything_rows: readonly ConnectAnythingRowRecord[] = [
  {
    kind: 'mcp',
    name: 'MCP server',
    icon: Plug,
    saves_a_credential_for_the_sandbox: false,
    what_it_is_for: 'Tools from any MCP server. You can give it an API key.',
    a_plain_team_member_reads: 'An owner or an admin adds servers for the team.',
  },
  { kind: 'api', name: 'HTTP API', icon: Code2, saves_a_credential_for_the_sandbox: true },
  {
    kind: 'website',
    name: 'Website sign-in',
    icon: Globe,
    saves_a_credential_for_the_sandbox: true,
  },
];

function useRowsThisInstallCanUse() {
  const credentials_never_reach_the_sandbox = useSavedCredentialsReachTheSandbox() === false;
  return connect_anything_rows.filter(
    (row) => !(row.saves_a_credential_for_the_sandbox && credentials_never_reach_the_sandbox),
  );
}

export function ConnectAnythingSection({
  onSelect,
}: {
  onSelect: (kind: ConnectAnythingKind) => void;
}) {
  const rows = useRowsThisInstallCanUse();
  return (
    <>
      <AppCatalogueSetupChoices />
      <section>
        <h2 className="mb-3 text-xs font-medium uppercase text-muted-foreground">
          Connect anything
        </h2>
        <div className="grid gap-x-8 gap-y-2 md:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <ConnectAnythingRow key={row.kind} row={row} onSelect={() => onSelect(row.kind)} />
          ))}
        </div>
      </section>
    </>
  );
}

function RowAnAdminAdds({ row, words }: { row: ConnectAnythingRowRecord; words: string }) {
  const Icon = row.icon;
  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3 rounded-2xl px-2 py-2">
      <div className="plate size-10 border border-dashed border-strong bg-transparent text-muted-foreground shadow-none">
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{row.name}</div>
        <p className="text-xs text-muted-foreground">{words}</p>
      </div>
    </div>
  );
}

function ConnectAnythingRow({
  row,
  onSelect,
}: {
  row: ConnectAnythingRowRecord;
  onSelect: () => void;
}) {
  const words_for_a_plain_member = use_is_plain_team_member()
    ? row.a_plain_team_member_reads
    : undefined;
  if (words_for_a_plain_member)
    return <RowAnAdminAdds row={row} words={words_for_a_plain_member} />;
  const Icon = row.icon;
  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)_32px] items-center gap-3 rounded-2xl px-2 py-2 hover:bg-hover">
      <button
        type="button"
        className="col-span-2 grid min-w-0 grid-cols-[44px_minmax(0,1fr)] items-center gap-3 text-left"
        onClick={onSelect}
      >
        <div className="plate size-10 border border-dashed border-strong bg-transparent text-muted-foreground shadow-none">
          <Icon className="size-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{row.name}</div>
          {row.what_it_is_for ? (
            <p className="text-xs text-muted-foreground">{row.what_it_is_for}</p>
          ) : null}
        </div>
      </button>
      <Button
        className="pointer-events-auto mx-auto rounded-full bg-muted text-muted-foreground hover:bg-hover"
        size="icon-sm"
        type="button"
        variant="secondary"
        aria-label={`Connect ${row.name}`}
        onClick={onSelect}
      >
        <Plus className="size-4" aria-hidden="true" />
      </Button>
    </div>
  );
}

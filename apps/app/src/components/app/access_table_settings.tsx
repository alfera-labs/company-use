import { Skeleton } from '@coworker/ui/components/skeleton';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { access_cell_words, short_person_name } from '@/components/app/access_table_words';
import { AppMark } from '@/components/app/app_mark';
import { type AccessTable, get_access_table } from '@/lib/api/access_table';
import { ApiError } from '@/lib/api/client';
import { query_keys } from '@/lib/api/query_keys';

export function AccessTableSettings() {
  const table = useQuery({ queryKey: query_keys.access_table(), queryFn: get_access_table });

  if (table.isPending) return <Skeleton className="h-64 w-full rounded-3xl" />;
  if (table.isError) {
    const is_not_an_admin = table.error instanceof ApiError && table.error.status === 403;
    return (
      <p className="text-muted-foreground text-sm">
        {is_not_an_admin
          ? 'Only an admin can read who can use each connection.'
          : 'The table could not load. Reload the page to try again.'}
      </p>
    );
  }
  if (table.data.connections.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nothing is connected yet.{' '}
        <Link className="text-foreground underline underline-offset-4" to="/integrations">
          Connect an app
        </Link>{' '}
        and it appears here.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <AccessGrid table={table.data} />
      </div>
      <p className="max-w-[70ch] text-muted-foreground text-xs text-pretty">
        A project name means only in that project's chats and Slack channels. Own chats means only
        when that person is the only reader. An empty cell means no access.
      </p>
    </div>
  );
}

function AccessGrid({ table }: { table: AccessTable }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr>
          <th className="sticky left-0 bg-background" />
          {table.people.map((person) => (
            <th
              className="whitespace-nowrap px-3 pb-3 text-left font-normal text-muted-foreground text-xs"
              key={person.user_id}
              scope="col"
              title={`${person.name} (${person.email})`}
            >
              {short_person_name(person)}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.connections.map((connection) => (
          <tr className="border-border border-t last:border-b" key={connection.connection_id}>
            <th
              className="sticky left-0 max-w-64 bg-background py-3.5 pr-4 text-left font-medium"
              scope="row"
            >
              <span className="flex items-center gap-2.5">
                <AppMark
                  iconUrl={connection.app_icon_url ?? undefined}
                  name={connection.app_display_name ?? connection.connection_name ?? 'App'}
                />
                <span className="truncate">
                  {connection.connection_name ?? connection.app_display_name ?? 'Connection'}
                </span>
              </span>
            </th>
            {connection.cells.map((cell) => (
              <td className="whitespace-nowrap px-3 py-3.5" key={cell.user_id}>
                {access_cell_words(cell, table.projects)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

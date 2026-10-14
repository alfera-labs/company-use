import { is_workspace_administrator_role } from '@coworker/shared';
import { Skeleton } from '@coworker/ui/components/skeleton';
import type { ReactNode } from 'react';
import { EmptyNote } from '@/components/app/empty_note';
import { use_team } from '@/components/app/use_team_mode';

/**
 * A setting of the coworker the whole team shares. A member sees who can change it instead of
 * controls the API would refuse.
 */
export function TeamModeAdminsOnly({ what, children }: { what: string; children: ReactNode }) {
  const team_query = use_team();
  if (team_query.isLoading) return <Skeleton className="h-10 rounded-2xl" />;
  if (is_workspace_administrator_role(team_query.data?.viewer_role)) return children;
  return (
    <EmptyNote>
      The whole team shares one coworker, so an owner or an admin chooses {what}. Ask one of them to
      change it.
    </EmptyNote>
  );
}

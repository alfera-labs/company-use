import { read_connection_audience, replacing } from '@/components/app/connection_audience';
import type { ResourceSharing, SharingGrantee } from '@/lib/api/endpoints';

type PersonEntry = Extract<SharingGrantee, { person: string }>;

export type PersonTick =
  | { save: ReturnType<typeof replacing> }
  | { ask: 'open_to_everyone' }
  | { refuse: string };

export function read_person_tick(sharing: ResourceSharing, person_id: string): PersonTick {
  const audience = read_connection_audience(sharing);
  if (audience.kind === 'custom') {
    return {
      refuse:
        'An admin set a custom audience for this connection, naming people as well as projects. ' +
        'Change it on the connection settings page so nothing here is lost.',
    };
  }

  const named = people_named_in(sharing);
  const is_named = named.some((entry) => entry.person === person_id);
  const people = is_named
    ? named.filter((entry) => entry.person !== person_id)
    : [...named, { person: person_id, can: 'use' } satisfies PersonEntry];
  if (people.length === 0) return { ask: 'open_to_everyone' };

  return {
    save: replacing(sharing, { shared_with_everyone_in_the_workspace: false, shared_with: people }),
  };
}

export function person_is_ticked(sharing: ResourceSharing, person_id: string): boolean {
  return people_named_in(sharing).some((entry) => entry.person === person_id);
}

function people_named_in(sharing: ResourceSharing): PersonEntry[] {
  if (read_connection_audience(sharing).kind === 'projects') return [];
  return sharing.shared_with.flatMap((entry) => ('person' in entry ? [entry] : []));
}

// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.

import { format_error_message } from '@coworker/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { body_for_everyone, replacing } from '@/components/app/connection_audience';
import { read_person_tick } from '@/components/app/connection_audience_people';
import { type ResourceSharing, set_resource_sharing } from '@/lib/api/endpoints';
import { query_keys } from '@/lib/api/query_keys';

type SharingChange = ReturnType<typeof replacing>;

/**
 * The people named on a connection, changed through the same save the audience menu uses, so the
 * page has one rule for who is on the list. A change shows at once and goes back if the server
 * refuses it. Taking the last person off would open the connection to everyone, so that asks first.
 */
export function use_connection_people(connection_id: string, sharing: ResourceSharing) {
  const query_client = useQueryClient();
  const sharing_key = query_keys.sharing('connection', connection_id);
  const [asking_to_open_to_everyone, set_asking_to_open_to_everyone] = useState(false);

  const save = useMutation({
    mutationFn: (change: SharingChange) =>
      set_resource_sharing('connection', connection_id, change),
    onMutate: async (change) => {
      await query_client.cancelQueries({ queryKey: sharing_key });
      const sharing_before = query_client.getQueryData<ResourceSharing>(sharing_key);
      query_client.setQueryData<ResourceSharing>(sharing_key, {
        ...sharing,
        shared_with_everyone_in_the_workspace: change.shared_with_everyone_in_the_workspace,
        shared_with: change.shared_with,
      });
      return { sharing_before };
    },
    onError: (error, _change, context) => {
      query_client.setQueryData(sharing_key, context?.sharing_before);
      toast.error(format_error_message(error, 'The change could not be saved.'));
    },
    onSettled: () =>
      Promise.all([
        query_client.invalidateQueries({ queryKey: sharing_key }),
        query_client.invalidateQueries({ queryKey: query_keys.connections() }),
      ]),
  });

  function add_or_remove(person_id: string) {
    const tick = read_person_tick(sharing, person_id);
    if ('refuse' in tick) return toast.error(tick.refuse);
    if ('ask' in tick) return set_asking_to_open_to_everyone(true);
    save.mutate(tick.save);
  }

  return {
    add_or_remove,
    asking_to_open_to_everyone,
    set_asking_to_open_to_everyone,
    open_to_everyone: () => save.mutate(replacing(sharing, body_for_everyone())),
  };
}

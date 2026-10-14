// biome-ignore-all lint/correctness/useHookAtTopLevel: Repository hook names use snake_case.
import { format_error_message } from '@coworker/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  type NotificationRules,
  type NotificationRulesChange,
  read_notification_rules,
  save_notification_rules,
} from '@/components/app/automations/automations_api';
import { query_keys } from '@/lib/api/query_keys';

const save_after_ms = 400;

export type ChangeRules = (changes: NotificationRulesChange) => void;

export function use_notification_rules_draft() {
  const policy_query = useQuery({
    queryKey: query_keys.notification_rules(),
    queryFn: read_notification_rules,
  });
  const [draft, set_draft] = useState<NotificationRules | null>(null);
  const pending = useRef<NotificationRulesChange>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = use_save_rules(pending, () => set_draft(null));

  const flush = () => {
    timer.current = null;
    const changes = pending.current;
    pending.current = {};
    if (Object.keys(changes).length > 0) save.mutate(changes);
  };
  use_flush_on_close(timer, flush);

  const policy = draft ?? policy_query.data?.policy ?? null;
  const change: ChangeRules = (changes) => {
    if (!policy) return;
    pending.current = { ...pending.current, ...changes };
    set_draft({ ...policy, ...changes } as NotificationRules);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, save_after_ms);
  };
  return { policy_query, policy, change };
}

function use_save_rules(pending: { current: NotificationRulesChange }, clear_draft: () => void) {
  const query_client = useQueryClient();
  return useMutation({
    mutationFn: save_notification_rules,
    onSuccess: async () => {
      await query_client.invalidateQueries({ queryKey: query_keys.notification_rules() });
      if (Object.keys(pending.current).length === 0) clear_draft();
    },
    onError: (error) => {
      pending.current = {};
      clear_draft();
      toast.error(format_error_message(error, 'Could not save how you want to be told'));
    },
  });
}

function use_flush_on_close(
  timer: { current: ReturnType<typeof setTimeout> | null },
  flush: () => void,
) {
  const flush_latest = useRef(flush);
  flush_latest.current = flush;
  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      flush_latest.current();
    },
    [timer],
  );
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDownIcon } from 'lucide-react';
import { useMyTimezone } from '@/components/app/use_my_timezone';
import { set_my_timezone } from '@/lib/api/my_timezone';
import { query_keys } from '@/lib/api/query_keys';

export function TimezoneSettings() {
  const query_client = useQueryClient();
  const timezone_query = useMyTimezone();
  const save = useMutation({
    mutationFn: set_my_timezone,
    onSuccess: (saved) => query_client.setQueryData(query_keys.my_timezone(), saved),
  });

  if (timezone_query.isPending) {
    return <p className="text-sm text-muted-foreground">Reading your time zone…</p>;
  }
  if (timezone_query.isError) {
    return <p className="text-sm text-muted-foreground">Your time zone did not load.</p>;
  }

  const stored_timezone = timezone_query.data.timezone;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="relative">
        <select
          aria-label="Time zone"
          className="field h-8 max-w-xs appearance-none ps-2.5 pe-8 text-sm"
          value={stored_timezone}
          disabled={save.isPending}
          onChange={(event) => save.mutate(event.target.value)}
        >
          {list_timezone_names(stored_timezone).map((timezone) => (
            <option key={timezone} value={timezone}>
              {timezone}
            </option>
          ))}
        </select>
        <ChevronDownIcon className="pointer-events-none absolute end-2.5 top-2 size-4 text-muted-foreground" />
      </div>
      {save.isError ? (
        <p className="text-sm text-destructive">The time zone was not saved. Try again.</p>
      ) : null}
    </div>
  );
}

function list_timezone_names(stored_timezone: string) {
  return [...new Set(['UTC', stored_timezone, ...Intl.supportedValuesOf('timeZone')])].sort();
}

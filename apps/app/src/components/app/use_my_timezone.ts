import { useQuery } from '@tanstack/react-query';
import { query_keys } from '@/lib/api/query_keys';
import { record_browser_timezone_once } from '@/lib/browser_timezone';

export function useMyTimezone() {
  return useQuery({
    queryKey: query_keys.my_timezone(),
    queryFn: record_browser_timezone_once,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

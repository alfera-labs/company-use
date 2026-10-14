import { useQuery } from '@tanstack/react-query';
import { list_agents } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export function useMainAgent() {
  const agents_query = useQuery({ queryKey: query_keys.agents(), queryFn: list_agents });

  return {
    ...agents_query,
    agent: agents_query.data?.find((candidate) => candidate.agent_kind === 'main') ?? null,
  };
}

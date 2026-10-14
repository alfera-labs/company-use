import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { list_models } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export function useModelOptions() {
  const models_query = useQuery({
    queryFn: list_models,
    queryKey: query_keys.models(),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
  const listed_models = models_query.data;
  const models = useMemo(
    () =>
      (listed_models ?? []).filter(
        (model) => (model.keys_that_unlock_this_model ?? []).length === 0,
      ),
    [listed_models],
  );
  const models_that_need_a_key = useMemo(
    () =>
      (listed_models ?? []).filter((model) => (model.keys_that_unlock_this_model ?? []).length > 0),
    [listed_models],
  );

  return { ...models_query, models, models_that_need_a_key };
}

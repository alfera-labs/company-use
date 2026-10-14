import { useQuery } from '@tanstack/react-query';
import { list_catalog_apps } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';

export function useCatalogApps() {
  return useQuery({
    queryFn: list_catalog_apps,
    queryKey: query_keys.catalog_apps(),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}

import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { PromptSuggestionGroup } from '@/components/app/chat_prompt_suggestions';
import { get_current_workspace, list_catalog_apps_by_keys, read_company_scan } from '@/lib/api';
import { query_keys } from '@/lib/api/query_keys';
import { select_suggestion_apps, suggestion_app_keys } from '@/lib/suggestion_apps';

export function useCompanyScanSuggestions(): PromptSuggestionGroup[] {
  const workspace_query = useQuery({
    queryKey: query_keys.workspace(),
    queryFn: get_current_workspace,
  });
  const scan = read_company_scan(workspace_query.data);

  return useMemo(() => {
    if (!scan || scan.findings.length === 0) return [];
    return [
      {
        label: scan.company_name,
        highlight: scan.company_name,
        prompt: `What would you start with at ${scan.company_name}?`,
        icon: Building2,
        appAliases: [],
        items: scan.findings.map((finding) => ({
          title: finding.title,
          outcome: finding.body,
          text: finding.prompt,
          appAliases: [],
        })),
      },
    ];
  }, [scan]);
}

export function useDeferredHomeSuggestionApps() {
  const [should_load_apps, set_should_load_apps] = useState(false);
  useEffect(() => {
    const load_apps = () => set_should_load_apps(true);
    const browser_window = window as Window & {
      cancelIdleCallback?: (handle: number) => void;
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
    };

    if (browser_window.requestIdleCallback && browser_window.cancelIdleCallback) {
      const handle = browser_window.requestIdleCallback(load_apps, { timeout: 2500 });
      return () => browser_window.cancelIdleCallback?.(handle);
    }

    // Safari fallback: a plain timer, late enough to stay off the first-paint path.
    const timeout = globalThis.setTimeout(load_apps, 1200);
    return () => globalThis.clearTimeout(timeout);
  }, []);

  const apps_query = useQuery({
    enabled: should_load_apps,
    queryFn: () => list_catalog_apps_by_keys(suggestion_app_keys),
    queryKey: query_keys.catalog_apps('suggestions'),
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });

  return useMemo(() => select_suggestion_apps(apps_query.data ?? []), [apps_query.data]);
}

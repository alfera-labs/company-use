import { Input } from '@coworker/ui/components/input';
import { Search } from 'lucide-react';
import {
  type IntegrationsTab,
  integrations_search_placeholder,
} from '@/components/app/integrations_catalogue_view';
import { useInstallHasAppCatalogue } from '@/lib/use_install_has_app_catalogue';

export function PageControls({
  activeTab,
  appCount,
  connectedCount,
  searchQuery,
  onSearchChange,
}: {
  activeTab: IntegrationsTab;
  appCount: number;
  connectedCount: number;
  searchQuery: string;
  onSearchChange: (value: string) => void;
}) {
  const has_app_catalogue = useInstallHasAppCatalogue() !== false;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-base font-medium tabular-nums">
        {activeTab === 'integrations'
          ? searchQuery
            ? `${appCount.toLocaleString()} search results`
            : 'Browse integrations'
          : `Found ${connectedCount.toLocaleString()} connected ${connectedCount === 1 ? 'integration' : 'integrations'}`}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative w-full sm:w-64">
          <label className="sr-only" htmlFor="connections-search">
            Search integrations
          </label>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="connections-search"
            className="h-9 rounded-2xl pl-9"
            placeholder={integrations_search_placeholder(activeTab, has_app_catalogue)}
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

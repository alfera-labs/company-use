import { ChevronDown } from 'lucide-react';
import { ProviderLogo } from '@/components/app/model_picker/provider_logo';
import type { ModelCatalogEntry } from '@/lib/api';

export function ModelPickerTriggerContent({
  model,
  label,
}: {
  model?: ModelCatalogEntry | null;
  label: string;
}) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-2">
        {model ? (
          <ProviderLogo
            model_provider={model.model_provider}
            provider_display_name={model.model_provider_display_name}
          />
        ) : null}
        <span className="truncate">{label}</span>
      </span>
      <ChevronDown className="size-4 shrink-0" />
    </>
  );
}

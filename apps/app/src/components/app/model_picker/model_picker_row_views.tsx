import type { ModelProxyLock } from '@coworker/shared';
import { Badge } from '@coworker/ui/components/badge';
import { ComboboxGroupLabel } from '@coworker/ui/components/combobox';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import { add_a_key_label } from '@/components/app/model_picker/add_model_key_note';
import {
  format_context_window,
  model_capabilities,
} from '@/components/app/model_picker/model_display';
import type { ModelPickerRow } from '@/components/app/model_picker/model_picker_rows';
import { ProviderLogo } from '@/components/app/model_picker/provider_logo';
import type { ModelCatalogEntry } from '@/lib/api';

export function ProviderRow({
  row,
  onToggle,
}: {
  row: Extract<ModelPickerRow, { row_kind: 'provider' }>;
  onToggle: () => void;
}) {
  return (
    <ComboboxGroupLabel
      className="flex w-full items-center justify-between gap-3 rounded-2xl px-2 py-2 text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
      render={
        <button
          aria-expanded={row.is_expanded}
          type="button"
          onClick={onToggle}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
          }}
        />
      }
    >
      <span className="flex min-w-0 items-center gap-2">
        <ProviderLogo
          model_provider={row.model_provider}
          provider_display_name={row.display_name}
        />
        <span className="truncate">{row.display_name}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
        {row.model_count}
        {row.is_expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
      </span>
    </ComboboxGroupLabel>
  );
}

export function PickerRowContent({
  row,
  isChosen,
}: {
  row: Exclude<ModelPickerRow, { row_kind: 'provider' }>;
  isChosen: boolean;
}) {
  if (row.row_kind === 'model') {
    return <ModelRow isChosen={isChosen} lock={row.lock} model={row.model} />;
  }

  return (
    <span className={`flex min-w-0 flex-1 items-start gap-2 ${row.lock ? 'opacity-50' : ''}`}>
      <ProviderLogo
        className="mt-0.5"
        model_provider={row.preset.model.model_provider}
        provider_display_name={row.preset.model.model_provider_display_name}
      />
      <span className="min-w-0">
        <span className="flex flex-wrap items-baseline gap-1.5">
          <span className="font-medium">{row.preset.label}</span>
          <span className="truncate text-muted-foreground">
            {row.preset.model.model_display_name}
          </span>
          <LockPill lock={row.lock} />
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{row.preset.description}</span>
      </span>
      {isChosen ? <Check className="mt-0.5 size-4 shrink-0" /> : null}
    </span>
  );
}

function ModelRow({
  model,
  isChosen,
  lock,
}: {
  model: ModelCatalogEntry;
  isChosen: boolean;
  lock: ModelProxyLock | null;
}) {
  const [key_to_add] = model.keys_that_unlock_this_model;
  return (
    <>
      <span className={`min-w-0 truncate ${lock || key_to_add ? 'opacity-50' : ''}`}>
        {model.model_display_name}
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
        {lock ? <LockPill lock={lock} /> : null}
        {!lock && key_to_add ? <span>{add_a_key_label(key_to_add)}</span> : null}
        {lock || key_to_add ? null : <ModelFacts model={model} />}
        {isChosen ? <Check className="size-4 text-foreground" /> : null}
      </span>
    </>
  );
}

function ModelFacts({ model }: { model: ModelCatalogEntry }) {
  return (
    <>
      <span>{format_context_window(model.context_window)}</span>
      {model_capabilities
        .filter((capability) => capability.is_supported(model))
        .map(({ icon_label, Icon }) => (
          <Icon aria-label={icon_label} className="size-3.5" key={icon_label} />
        ))}
    </>
  );
}

export const lock_pill_labels: Record<ModelProxyLock, string> = {
  locked_until_subscribed: 'Paid plan',
  gateway_not_funded: 'Coming soon',
};

function LockPill({ lock }: { lock: ModelProxyLock | null }) {
  if (!lock) return null;

  return (
    <Badge className="shrink-0" variant="outline">
      {lock_pill_labels[lock]}
    </Badge>
  );
}

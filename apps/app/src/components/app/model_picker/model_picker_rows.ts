import {
  find_model_proxy_lock,
  type ModelAccessRules,
  type ModelProxyLock,
  unrestricted_model_access,
} from '@coworker/shared';
import {
  group_models_by_provider,
  needs_a_new_key,
} from '@/components/app/model_picker/group_models_by_provider';
import {
  choose_this_model,
  is_the_same_choice,
  type ModelChoice,
  model_option_key,
} from '@/components/app/model_picker/model_choice';
import {
  list_resolved_model_presets,
  type ResolvedModelPreset,
  searchable_preset_text,
} from '@/components/app/model_picker/model_presets';
import type { ModelCatalogEntry } from '@/lib/api';
import { matches_every_word } from '@/lib/text_search';

export type ModelPickerRow =
  | {
      row_kind: 'preset';
      row_key: string;
      preset: ResolvedModelPreset;
      lock: ModelProxyLock | null;
    }
  | {
      row_kind: 'provider';
      row_key: string;
      model_provider: string;
      display_name: string;
      model_count: number;
      is_expanded: boolean;
    }
  | {
      row_kind: 'model';
      row_key: string;
      model: ModelCatalogEntry;
      lock: ModelProxyLock | null;
    };

export type ModelPickerRowGroup = {
  group_key: string;
  provider_row: Extract<ModelPickerRow, { row_kind: 'provider' }> | null;
  rows: Array<Exclude<ModelPickerRow, { row_kind: 'provider' }>>;
};

export function build_model_picker_rows(input: {
  models: ModelCatalogEntry[];
  query: string;
  expanded_providers: ReadonlySet<string>;
  inherited_model: ModelCatalogEntry | null;
  inherited_choice?: ModelChoice;
  model_access?: ModelAccessRules;
}): ModelPickerRow[] {
  const model_access = input.model_access ?? unrestricted_model_access;
  const presets = list_resolved_model_presets(
    input.models.filter((model) => !needs_a_new_key(model)),
    input.inherited_model,
    input.inherited_choice,
  )
    .filter((preset) => matches_every_word(searchable_preset_text(preset), input.query))
    .map(
      (preset): ModelPickerRow => ({
        row_kind: 'preset',
        row_key: preset.option_key,
        preset,
        lock: find_preset_lock(preset, model_access),
      }),
    );

  return [
    ...presets,
    ...provider_rows(input.models, input.query, input.expanded_providers, model_access),
  ];
}

function find_preset_lock(preset: ResolvedModelPreset, model_access: ModelAccessRules) {
  if (preset.choice.choose_model_by !== 'use_this_exact_model') return null;

  return find_model_proxy_lock(preset.model.model_proxy, model_access);
}

export function toggle_provider(expanded_providers: ReadonlySet<string>, model_provider: string) {
  const next = new Set(expanded_providers);
  if (!next.delete(model_provider)) next.add(model_provider);
  return next;
}

export function show_chosen_model_provider(
  expanded_providers: ReadonlySet<string>,
  choice: ModelChoice,
) {
  if (
    choice.choose_model_by === 'let_alfera_recommend' ||
    expanded_providers.has(choice.model_provider)
  ) {
    return expanded_providers;
  }

  return new Set([...expanded_providers, choice.model_provider]);
}

export function list_selectable_option_keys(rows: ModelPickerRow[]) {
  return rows.flatMap((row) => (row.row_kind === 'provider' ? [] : [row.row_key]));
}

export function group_model_picker_rows(rows: ModelPickerRow[]): ModelPickerRowGroup[] {
  const groups: ModelPickerRowGroup[] = [];

  for (const row of rows) {
    if (row.row_kind === 'provider') {
      groups.push({ group_key: row.row_key, provider_row: row, rows: [] });
      continue;
    }

    const last_group = groups.at(-1);
    if (row.row_kind === 'preset' && (!last_group || last_group.provider_row)) {
      groups.push({ group_key: 'presets', provider_row: null, rows: [row] });
      continue;
    }
    if (!last_group) {
      groups.push({ group_key: 'models', provider_row: null, rows: [row] });
      continue;
    }
    last_group.rows.push(row);
  }

  return groups;
}

export function find_row_choice(rows: ModelPickerRow[], option_key: string): ModelChoice | null {
  const row = find_row(rows, option_key);
  if (row?.row_kind === 'provider' || row?.lock) return null;
  if (row?.row_kind === 'model' && needs_a_new_key(row.model)) return null;
  if (row?.row_kind === 'preset') return row.preset.choice;
  if (row?.row_kind === 'model') return choose_this_model(row.model);

  return null;
}

export function find_row_lock(rows: ModelPickerRow[], option_key: string): ModelProxyLock | null {
  const row = find_row(rows, option_key);

  return row && row.row_kind !== 'provider' ? row.lock : null;
}

export function find_row_keys_to_add(rows: ModelPickerRow[], option_key: string) {
  const row = find_row(rows, option_key);
  return row?.row_kind === 'model' ? row.model.keys_that_unlock_this_model : [];
}

export function find_row_model(rows: ModelPickerRow[], option_key: string | undefined) {
  const row = option_key === undefined ? undefined : find_row(rows, option_key);
  if (row?.row_kind === 'model') return row.model;
  if (row?.row_kind === 'preset') return row.preset.model;

  return null;
}

export function selected_option_key(rows: ModelPickerRow[], choice: ModelChoice) {
  if (choice.choose_model_by === 'let_alfera_recommend') {
    return rows.find((row) => row.row_kind === 'preset' && row.preset.preset_name === 'inherit')
      ?.row_key;
  }
  return rows.find(
    (row) => row.row_kind === 'model' && is_the_same_choice(choose_this_model(row.model), choice),
  )?.row_key;
}

function find_row(rows: ModelPickerRow[], option_key: string) {
  return rows.find((candidate) => candidate.row_key === option_key);
}

function provider_rows(
  models: ModelCatalogEntry[],
  query: string,
  expanded_providers: ReadonlySet<string>,
  model_access: ModelAccessRules,
): ModelPickerRow[] {
  return group_models_by_provider(models, query).flatMap((provider) => {
    const is_expanded = Boolean(query.trim()) || expanded_providers.has(provider.model_provider);
    const header: ModelPickerRow = {
      row_kind: 'provider',
      row_key: `provider:${provider.model_provider}`,
      model_provider: provider.model_provider,
      display_name: provider.display_name,
      model_count: provider.models.length,
      is_expanded,
    };
    if (!is_expanded) return [header];

    return [
      header,
      ...provider.models.map(
        (model): ModelPickerRow => ({
          row_kind: 'model',
          row_key: model_option_key(model),
          model,
          lock: find_model_proxy_lock(model.model_proxy, model_access),
        }),
      ),
    ];
  });
}

import { describe, expect, it } from 'vitest';
import { real_model_catalog_entries } from '@/components/app/model_picker/__tests__/real_model_catalog';
import { add_a_key_label } from '@/components/app/model_picker/add_model_key_note';
import { group_models_by_provider } from '@/components/app/model_picker/group_models_by_provider';
import {
  build_model_picker_rows,
  find_row_choice,
  find_row_keys_to_add,
} from '@/components/app/model_picker/model_picker_rows';
import type { ModelCatalogEntry } from '@/lib/api';

const usable_models = real_model_catalog_entries;
const google_key = { provider_slot: 'google' as const, display_name: 'Google' };
const openrouter_key = { provider_slot: 'openrouter' as const, display_name: 'OpenRouter' };
const gemini: ModelCatalogEntry = {
  ...(usable_models[0] as ModelCatalogEntry),
  model_id: 'gemini-3.6-flash',
  model_display_name: 'Gemini 3.6 Flash',
  model_provider: 'google',
  model_provider_display_name: 'Google',
  model_proxy: 'google_direct',
  speed_out_of_five: 5,
  intelligence_out_of_five: 5,
  keys_that_unlock_this_model: [google_key, openrouter_key],
};

const rows = build_model_picker_rows({
  models: [...usable_models, gemini],
  query: 'gemini',
  expanded_providers: new Set(),
  inherited_model: null,
});
const gemini_key = 'google_direct:gemini-3.6-flash';

describe('a model the install has no key for', () => {
  it('is listed, but choosing it opens no run on it', () => {
    expect(rows.some((row) => row.row_key === gemini_key)).toBe(true);
    expect(find_row_choice(rows, gemini_key)).toBeNull();
  });

  it('names its own key first, then the one key for all models', () => {
    expect(find_row_keys_to_add(rows, gemini_key)).toEqual([google_key, openrouter_key]);
    expect(add_a_key_label(google_key)).toBe('Add a Google key');
    expect(add_a_key_label({ provider_slot: 'openai', display_name: 'OpenAI' })).toBe(
      'Add an OpenAI key',
    );
    expect(add_a_key_label({ provider_slot: 'xai', display_name: 'xAI' })).toBe('Add an xAI key');
  });

  it('is never a shortcut, even when it rates best', () => {
    const all_rows = build_model_picker_rows({
      models: [...usable_models, gemini],
      query: '',
      expanded_providers: new Set(),
      inherited_model: null,
    });
    const presets = all_rows.flatMap((row) => (row.row_kind === 'preset' ? [row.preset] : []));

    expect(presets.length).toBeGreaterThan(0);
    expect(presets.every((preset) => preset.model.model_id !== gemini.model_id)).toBe(true);
  });

  it('puts providers with a usable model above providers that need a key', () => {
    const providers = group_models_by_provider([gemini, ...usable_models], '');

    expect(providers.at(-1)?.model_provider).toBe('google');
  });
});

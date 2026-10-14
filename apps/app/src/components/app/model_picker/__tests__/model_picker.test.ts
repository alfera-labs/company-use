import { type ModelAccessRules, unrestricted_model_access } from '@coworker/shared';
import { describe, expect, it } from 'vitest';
import { real_model_catalog_entries } from '@/components/app/model_picker/__tests__/real_model_catalog';
import {
  choose_this_model,
  let_alfera_recommend,
  written_default_model,
  written_message_model,
} from '@/components/app/model_picker/model_choice';
import { describe_model_choice } from '@/components/app/model_picker/model_display';
import { lock_pill_labels } from '@/components/app/model_picker/model_picker_row_views';
import {
  build_model_picker_rows,
  find_row_choice,
  find_row_lock,
  group_model_picker_rows,
  list_selectable_option_keys,
  type ModelPickerRow,
  selected_option_key,
  show_chosen_model_provider,
  toggle_provider,
} from '@/components/app/model_picker/model_picker_rows';
import {
  find_inherited_model,
  list_resolved_model_presets,
} from '@/components/app/model_picker/model_presets';

const models = real_model_catalog_entries;
const recommended = models.find((model) => model.is_recommended_for_agent_runs) ?? null;
const opus = models.find((model) => model.model_id === 'claude-opus-4-6');

function rows_for(options: {
  query?: string;
  expanded_providers?: ReadonlySet<string>;
  inherited_model?: (typeof models)[number] | null;
}) {
  return build_model_picker_rows({
    models,
    query: options.query ?? '',
    expanded_providers: options.expanded_providers ?? new Set(),
    inherited_model: options.inherited_model ?? null,
  });
}

const collapsed = rows_for({});

describe('model presets', () => {
  it('offers exactly the three shortcuts, each naming the model it resolved to', () => {
    const presets = list_resolved_model_presets(models);

    expect(presets.map((preset) => preset.preset_name)).toEqual(['inherit', 'smartest', 'fastest']);
    expect(presets.map((preset) => preset.label)).toEqual(['Recommended', 'Smartest', 'Fastest']);
    for (const preset of presets) expect(preset.model.model_display_name).toBeTruthy();
  });

  it('picks the smartest and the fastest from the ratings, not from the catalog order', () => {
    const presets = list_resolved_model_presets(models);
    const smartest = presets.find((preset) => preset.preset_name === 'smartest');
    const fastest = presets.find((preset) => preset.preset_name === 'fastest');

    expect(smartest?.model.intelligence_out_of_five).toBe(
      Math.max(...models.map((model) => model.intelligence_out_of_five ?? 0)),
    );
    expect(fastest?.model.speed_out_of_five).toBe(
      Math.max(...models.map((model) => model.speed_out_of_five ?? 0)),
    );
  });

  it('breaks a rating tie toward the newest release, not the alphabetically first name', () => {
    const base = models[0] as (typeof models)[number];
    const haiku_3 = {
      ...base,
      model_id: 'claude-3-haiku',
      model_display_name: 'Claude Haiku 3',
      release_date: '2024-03-13',
      speed_out_of_five: 5,
      intelligence_out_of_five: 3,
    };
    const haiku_4_5 = {
      ...base,
      model_id: 'claude-haiku-4-5',
      model_display_name: 'Claude Haiku 4.5',
      release_date: '2025-10-15',
      speed_out_of_five: 5,
      intelligence_out_of_five: 3,
    };
    const fastest = list_resolved_model_presets([haiku_3, haiku_4_5]).find(
      (preset) => preset.preset_name === 'fastest',
    );

    expect(fastest?.model.model_id).toBe('claude-haiku-4-5');
  });

  it('leaves the model unpinned for the inherit row and pins one for the other two', () => {
    const by_name = Object.fromEntries(
      list_resolved_model_presets(models).map((preset) => [preset.preset_name, preset]),
    );

    expect(written_default_model(by_name.inherit?.choice ?? let_alfera_recommend)).toBeNull();
    expect(written_default_model(by_name.smartest?.choice ?? let_alfera_recommend)).toMatchObject({
      model_name: by_name.smartest?.model.model_id,
    });
  });

  it('names the inherited model rather than the recommendation when something sits above it', () => {
    if (!opus) throw new Error('fixture is missing Claude Opus 4.6');
    const [inherit_row] = list_resolved_model_presets(models, opus);

    expect(inherit_row?.label).toBe('Agent default');
    expect(inherit_row?.model.model_display_name).toBe('Claude Opus 4.6');
    expect(written_default_model(inherit_row?.choice ?? choose_this_model(opus))).toBeNull();
  });

  it('falls back to the recommendation when nothing sits above it', () => {
    expect(find_inherited_model(models, let_alfera_recommend)).toBe(recommended);
    if (!opus) throw new Error('fixture is missing Claude Opus 4.6');
    expect(find_inherited_model(models, choose_this_model(opus))).toBe(opus);
  });

  it('does not call a recommendation the agent default when the exact inherited route vanished', () => {
    const unavailable = {
      choose_model_by: 'use_this_exact_model' as const,
      model_provider: 'anthropic',
      model_proxy: 'vercel_ai_gateway',
      model_proxy_display_name: 'Vercel AI Gateway',
      model_provider_logo_url: null,
      model_name: 'anthropic/retired-model',
    };

    expect(
      list_resolved_model_presets(models, null, unavailable).map((preset) => preset.label),
    ).toEqual(['Smartest', 'Fastest']);
  });
});

describe('model picker rows', () => {
  it('shows the shortcuts and one collapsed row per maker, not two hundred models', () => {
    expect(collapsed.filter((row) => row.row_kind === 'preset')).toHaveLength(3);
    expect(collapsed.filter((row) => row.row_kind === 'model')).toHaveLength(0);
    expect(
      collapsed.filter((row) => row.row_kind === 'provider').map((row) => row.row_key),
    ).toEqual(['provider:anthropic', 'provider:openai']);
  });

  it("lists a maker's models only once opened", () => {
    const shown = rows_for({ expanded_providers: toggle_provider(new Set(), 'anthropic') }).filter(
      (row) => row.row_kind === 'model',
    );

    expect(shown.length).toBeGreaterThan(0);
    for (const row of shown) {
      if (row.row_kind === 'model') expect(row.model.model_provider).toBe('anthropic');
    }
  });

  it('reaches into every maker at once while searching, without anyone opening a section', () => {
    const searched = rows_for({ query: 'gpt' });

    expect(searched.filter((row) => row.row_kind === 'provider').map((row) => row.row_key)).toEqual(
      ['provider:openai'],
    );
    expect(searched.filter((row) => row.row_kind === 'model')).not.toHaveLength(0);
  });

  it('never lets a maker heading be chosen as a model', () => {
    expect(list_selectable_option_keys(collapsed).some((key) => key.startsWith('provider:'))).toBe(
      false,
    );
    expect(find_row_choice(collapsed, 'provider:anthropic')).toBeNull();
  });

  it('turns a chosen row back into the model it stands for', () => {
    const opened = rows_for({ expanded_providers: toggle_provider(new Set(), 'openai') });
    const gpt = opened.find(
      (row) => row.row_kind === 'model' && row.model.model_display_name === 'GPT-5.5',
    );
    if (gpt?.row_kind !== 'model') throw new Error('fixture is missing GPT-5.5');

    expect(find_row_choice(opened, gpt.row_key)).toEqual({
      choose_model_by: 'use_this_exact_model',
      model_provider: 'openai',
      model_proxy: 'openai_direct',
      model_name: 'gpt-5.5',
    });
  });

  it('keeps every exact proxy route separately selectable', () => {
    const direct_gpt = models.find((model) => model.model_id === 'gpt-5.5');
    if (!direct_gpt) throw new Error('fixture is missing GPT-5.5');
    const gateway_gpt = {
      ...direct_gpt,
      model_id: 'openai/gpt-5.5',
      model_proxy: 'vercel_ai_gateway',
      model_proxy_display_name: 'Vercel AI Gateway',
      model_provider_logo_url: null,
    };
    const route_models = [...models, gateway_gpt];
    const every_key = list_selectable_option_keys(
      build_model_picker_rows({
        models: route_models,
        query: '',
        expanded_providers: new Set(['anthropic', 'openai']),
        inherited_model: null,
      }),
    );

    expect(every_key).toContain('openai_direct:gpt-5.5');
    expect(every_key).toContain('vercel_ai_gateway:openai/gpt-5.5');
    expect(new Set(every_key)).toHaveLength(every_key.length);
  });

  it('groups headings with their options and selects only the exact active route', () => {
    const opened = rows_for({ expanded_providers: new Set(['anthropic', 'openai']) });
    const groups = group_model_picker_rows(opened);
    const gpt = models.find((model) => model.model_id === 'gpt-5.5');
    if (!gpt) throw new Error('fixture is missing GPT-5.5');

    expect(groups[0]).toMatchObject({ group_key: 'presets', provider_row: null });
    expect(groups.slice(1).every((group) => group.provider_row !== null)).toBe(true);
    expect(selected_option_key(opened, choose_this_model(gpt))).toBe('openai_direct:gpt-5.5');
  });

  it("opens the chosen model's maker so the selected option is present in the listbox", () => {
    if (!opus) throw new Error('fixture is missing Claude Opus 4.6');

    expect([...show_chosen_model_provider(new Set(), choose_this_model(opus))]).toEqual([
      'anthropic',
    ]);
    expect(show_chosen_model_provider(new Set(['openai']), let_alfera_recommend)).toEqual(
      new Set(['openai']),
    );
  });
});

describe('the closed picker', () => {
  it('names the model the platform resolved to when nothing is pinned', () => {
    expect(describe_model_choice(models, let_alfera_recommend, null)).toBe(
      'Recommended (Claude Sonnet 5)',
    );
  });

  it('names the inherited model when the surface above already has one', () => {
    if (!opus) throw new Error('fixture is missing Claude Opus 4.6');
    expect(describe_model_choice(models, let_alfera_recommend, opus)).toBe(
      'Agent default (Claude Opus 4.6)',
    );
  });

  it('writes the recommendation as nothing at all on both surfaces', () => {
    expect(written_default_model(let_alfera_recommend)).toBeNull();
    expect(written_message_model(let_alfera_recommend)).toEqual({});
  });

  it('names an exact pinned route when the live catalog no longer contains it', () => {
    const unavailable = {
      choose_model_by: 'use_this_exact_model' as const,
      model_provider: 'anthropic',
      model_proxy: 'vercel_ai_gateway',
      model_proxy_display_name: 'Vercel AI Gateway',
      model_provider_logo_url: null,
      model_name: 'anthropic/retired-model',
    };

    expect(describe_model_choice(models, unavailable, null)).toBe(
      'anthropic/retired-model (Unavailable)',
    );
    expect(describe_model_choice(models, let_alfera_recommend, null, unavailable)).toBe(
      'Agent default (anthropic/retired-model unavailable)',
    );
  });
});

describe('models a workspace cannot run yet', () => {
  const locked = { model_access: 'openai_only', gateway_models_enabled: false } as const;
  const trialing = { model_access: 'all', gateway_models_enabled: false } as const;
  const gateway_gpt = {
    ...(models.find((model) => model.model_id === 'gpt-5.5') as (typeof models)[number]),
    model_id: 'openai/gpt-5.5',
    model_proxy: 'vercel_ai_gateway',
    model_proxy_display_name: 'Vercel AI Gateway',
    model_provider_logo_url: null,
  };

  function every_model_row(options: {
    model_access: ModelAccessRules;
    catalog?: typeof models;
  }): Array<Extract<ModelPickerRow, { row_kind: 'model' }>> {
    return build_model_picker_rows({
      models: options.catalog ?? models,
      query: '',
      expanded_providers: new Set(['anthropic', 'openai']),
      inherited_model: null,
      model_access: options.model_access,
    }).filter((row) => row.row_kind === 'model');
  }

  it('locks Claude and leaves every OpenAI model alone for a card-less workspace', () => {
    const rows = every_model_row({ model_access: locked });
    const locked_providers = new Set(
      rows.filter((row) => row.lock).map((row) => row.model.model_provider),
    );

    expect(rows.length).toBeGreaterThan(0);
    expect([...locked_providers]).toEqual(['anthropic']);
    for (const row of rows.filter((row) => row.lock)) {
      expect(row.lock).toBe('locked_until_subscribed');
    }
  });

  it('unlocks Claude the moment the free trial starts', () => {
    expect(every_model_row({ model_access: trialing }).every((row) => row.lock === null)).toBe(
      true,
    );
  });

  it('locks a gateway model for a paying workspace, with the other reason', () => {
    const catalog = [...models, gateway_gpt];
    const gateway_row = every_model_row({ model_access: trialing, catalog }).find(
      (row) => row.model.model_proxy === 'vercel_ai_gateway',
    );

    expect(gateway_row?.lock).toBe('gateway_not_funded');
  });

  it('refuses to turn a locked row into a choice', () => {
    const rows = build_model_picker_rows({
      models,
      query: '',
      expanded_providers: new Set(['anthropic']),
      inherited_model: null,
      model_access: locked,
    });
    const claude = rows.find((row) => row.row_kind === 'model' && row.lock);
    if (!claude) throw new Error('expected a locked Claude row');

    expect(find_row_choice(rows, claude.row_key)).toBeNull();
    expect(find_row_lock(rows, claude.row_key)).toBe('locked_until_subscribed');
  });

  it('locks the shortcuts that pin a locked model and never the one that pins nothing', () => {
    const presets = build_model_picker_rows({
      models,
      query: '',
      expanded_providers: new Set(),
      inherited_model: null,
      model_access: locked,
    }).filter((row) => row.row_kind === 'preset');
    const by_name = Object.fromEntries(presets.map((row) => [row.preset.preset_name, row]));

    expect(by_name.inherit?.lock).toBeNull();
    expect(by_name.smartest?.preset.model.model_provider).toBe('anthropic');
    expect(by_name.smartest?.lock).toBe('locked_until_subscribed');
    expect(find_row_choice(presets, by_name.smartest?.row_key ?? '')).toBeNull();
    expect(find_row_choice(presets, by_name.inherit?.row_key ?? '')).toEqual(let_alfera_recommend);
  });

  it('labels the two waits as what they are', () => {
    expect(lock_pill_labels.locked_until_subscribed).toBe('Paid plan');
    expect(lock_pill_labels.gateway_not_funded).toBe('Coming soon');
  });

  it('locks nothing while the billing answer has not arrived', () => {
    expect(
      every_model_row({ model_access: unrestricted_model_access }).some((row) => row.lock),
    ).toBe(false);
  });
});

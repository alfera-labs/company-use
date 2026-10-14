import {
  PI_DEFAULT_COMPACTION_SETTINGS,
  pi_compaction_settings_for_token_budget,
} from '@agent-core/engines/pi/pi_compaction';
import { get_pi_model } from '@agent-core/engines/pi/pi_model';
import { describe, expect, it } from 'vitest';

describe('pi_compaction_settings_for_token_budget', () => {
  it('reserves everything above the budget on a 200k-window model', () => {
    const model = { model_provider: 'anthropic', model_name: 'claude-opus-4-5' };
    expect(get_pi_model(model)?.contextWindow).toBe(200_000);

    expect(pi_compaction_settings_for_token_budget(model, 100_000)).toEqual({
      ...PI_DEFAULT_COMPACTION_SETTINGS,
      reserveTokens: 100_000,
    });
  });

  it('fires earlier for the soft tier than for the hard tier', () => {
    const model = { model_provider: 'anthropic', model_name: 'claude-opus-4-5' };

    expect(pi_compaction_settings_for_token_budget(model, 100_000 * 0.9).reserveTokens).toBe(
      110_000,
    );
    expect(pi_compaction_settings_for_token_budget(model, 100_000 * 0.7).reserveTokens).toBe(
      130_000,
    );
  });

  it('leaves the defaults alone when the window is smaller than the budget', () => {
    expect(
      pi_compaction_settings_for_token_budget(
        { model_provider: 'anthropic', model_name: 'claude-opus-4-5' },
        400_000,
      ),
    ).toEqual(PI_DEFAULT_COMPACTION_SETTINGS);
  });

  it('falls back to the defaults for a model the pi registry does not know', () => {
    expect(
      pi_compaction_settings_for_token_budget(
        { model_provider: 'mystery-provider', model_name: 'not-a-real-model' },
        100_000,
      ),
    ).toEqual(PI_DEFAULT_COMPACTION_SETTINGS);
  });
});

import { format_provider_display_name } from '@api/services/models/provider_display_name';
import { describe, expect, it } from 'vitest';

describe('provider display names', () => {
  it('names a provider models.dev does not carry', () => {
    const named = (model_provider: string) =>
      format_provider_display_name({ catalog_name: undefined, model_provider });

    expect(named('amazon')).toBe('Amazon');
    expect(named('bytedance')).toBe('Bytedance');
    expect(named('arcee-ai')).toBe('Arcee AI');
    expect(named('perplexity_ai')).toBe('Perplexity AI');
  });

  it('keeps the name models.dev gives and drops the domain it glues on', () => {
    const named = (catalog_name: string) =>
      format_provider_display_name({ catalog_name, model_provider: 'ignored' });

    expect(named('MiniMax (minimax.io)')).toBe('MiniMax');
    expect(named('Anthropic')).toBe('Anthropic');
    expect(named('Z.AI')).toBe('Z.AI');
  });

  it('leaves a parenthetical that carries meaning alone', () => {
    expect(
      format_provider_display_name({ catalog_name: 'Baseten (open models)', model_provider: 'x' }),
    ).toBe('Baseten (open models)');
  });
});

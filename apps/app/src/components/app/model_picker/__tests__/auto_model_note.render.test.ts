import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { real_model_catalog_entries } from '@/components/app/model_picker/__tests__/real_model_catalog';
import { AutoModelNote, describe_auto_model } from '@/components/app/model_picker/auto_model_note';
import {
  choose_this_model,
  let_alfera_recommend,
} from '@/components/app/model_picker/model_choice';
import { ProviderBillingNote } from '@/components/app/model_picker/provider_billing_note';

const models = real_model_catalog_entries;
const recommended = models.find((model) => model.is_recommended_for_agent_runs);
const another = models.find((model) => !model.is_recommended_for_agent_runs);

describe('the sentence under the default model', () => {
  it('names the recommended model when the agent has no model of its own', () => {
    if (!recommended) throw new Error('The catalog recommends no model.');

    expect(describe_auto_model(models, let_alfera_recommend)).toBe(
      `A chat set to Auto uses ${recommended.model_display_name}.`,
    );
  });

  it('names the model of the agent when the agent has one', () => {
    if (!another) throw new Error('The catalog holds one model.');

    expect(describe_auto_model(models, choose_this_model(another))).toBe(
      `A chat set to Auto uses ${another.model_display_name}.`,
    );
  });

  it('says nothing when the model of the agent is not in the catalog', () => {
    const gone = {
      choose_model_by: 'use_this_exact_model',
      model_provider: 'anthropic',
      model_proxy: 'anthropic_direct',
      model_proxy_display_name: 'Anthropic',
      model_provider_logo_url: null,
      model_name: 'a-model-that-is-gone',
    } as const;

    expect(describe_auto_model(models, gone)).toBeUndefined();
    expect(
      renderToStaticMarkup(createElement(AutoModelNote, { models, defaultChoice: gone })),
    ).toBe('');
  });

  it('is one quiet line', () => {
    if (!recommended) throw new Error('The catalog recommends no model.');
    const html = renderToStaticMarkup(
      createElement(AutoModelNote, { models, defaultChoice: let_alfera_recommend }),
    );

    expect(html).toBe(
      `<p class="mt-2 text-muted-foreground text-xs">A chat set to Auto uses ${recommended.model_display_name}.</p>`,
    );
  });
});

describe('the footer of the model list on an install that runs on its own keys', () => {
  it('says who the person pays, in one sentence', () => {
    const html = renderToStaticMarkup(createElement(ProviderBillingNote));

    expect(html).toContain('>You pay your model provider for each token.</p>');
    expect(html).not.toContain('credits');
  });
});

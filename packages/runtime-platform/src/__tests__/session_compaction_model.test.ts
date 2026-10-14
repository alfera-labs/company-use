import { resolve_session_compaction_model } from '@runtime-platform/session_harness/session_compaction_model';
import { describe, expect, it } from 'vitest';

const session_model = {
  model_provider: 'anthropic',
  model_name: 'claude-sonnet-5',
  model_proxy: 'anthropic_direct',
  reasoning_level: 'high' as const,
};

describe('resolve_session_compaction_model', () => {
  it('summarises on the cheap OpenAI model, not the session model', () => {
    const model = resolve_session_compaction_model(session_model, { OPENAI_API_KEY: 'sk-test' });

    expect(model.model_proxy).toBe('openai_direct');
    expect(model.model_name).toBe('gpt-5.6-luna');
    expect(model.model_provider).toBe('openai');
  });

  it('does not inherit the session reasoning level', () => {
    const model = resolve_session_compaction_model(session_model, { OPENAI_API_KEY: 'sk-test' });

    expect(model.reasoning_level).toBe('low');
  });

  it('falls back to the session model when no summary proxy holds a credential', () => {
    expect(resolve_session_compaction_model(session_model, {})).toEqual(session_model);
  });

  it('does not carry the use-case output cap into compaction', () => {
    const model = resolve_session_compaction_model(session_model, { OPENAI_API_KEY: 'sk-test' });

    expect(model.max_output_tokens).toBeUndefined();
  });

  it('prefers a deployment override over the packaged default', () => {
    const model = resolve_session_compaction_model(session_model, {
      OPENAI_API_KEY: 'sk-test',
      OPENAI_SESSION_SUMMARY_MODEL: 'gpt-5.4-mini',
    });

    expect(model.model_name).toBe('gpt-5.4-mini');
  });
});

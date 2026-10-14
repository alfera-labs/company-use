import {
  run_failure_sentence,
  runtime_failure_text,
} from '@runtime-platform/orchestrator/run_failure_sentence';
import { describe, expect, it } from 'vitest';

const self_hosted = { is_self_hosted: true };
const doctor = 'On the server, run ./alfera doctor to find the fix.';

describe('the sentence the chat shows for a failed run', () => {
  it.each([
    [
      'the sandbox could not start',
      { message: 'The sandbox network alfera-sandbox could not be made.', sandbox_started: false },
      'The sandbox could not start, so I did not run this.',
    ],
    [
      'the provider refused the key',
      {
        message: '401 Incorrect API key provided: sk-test. You can find your key in the dashboard.',
      },
      'The model provider refused the API key, so I could not answer.',
    ],
    [
      'the provider refused the key (other wording)',
      { message: 'authentication_error: invalid x-api-key' },
      'The model provider refused the API key, so I could not answer.',
    ],
    [
      'the provider refused the model',
      { message: '404 The model `gpt-9` does not exist or you do not have access to it.' },
      'The model provider refused the model, so I could not answer.',
    ],
    [
      'a model server has no model of that name',
      { message: '404 model "llama9" not found, try pulling it first' },
      'The model provider refused the model, so I could not answer.',
    ],
    [
      'the provider is out of credit',
      {
        message: '429 You exceeded your current quota, please check your plan and billing details.',
      },
      'The model provider says the account is out of credit, so I could not answer.',
    ],
    [
      'the provider is out of credit (other wording)',
      { message: 'Your credit balance is too low to access the API.' },
      'The model provider says the account is out of credit, so I could not answer.',
    ],
  ])('names the cause when %s', (_cause, failure, sentence) => {
    expect(run_failure_sentence(failure, self_hosted)).toBe(`${sentence} ${doctor}`);
  });

  it('keeps the plain sentence for an unknown cause, with the command', () => {
    const failure = {
      message: 'duplicate key value violates unique constraint',
      sandbox_started: true,
    };

    expect(run_failure_sentence(failure, self_hosted)).toBe(`${runtime_failure_text} ${doctor}`);
  });

  it('says the provider declined the request, and names no command the server cannot help with', () => {
    const failure = {
      message:
        "Model provider request error: This request triggered restrictions on violative cyber content and was blocked under Anthropic's Usage Policy. To learn more, see https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback.",
    };

    expect(run_failure_sentence(failure, self_hosted)).toBe(
      'The model provider declined this request under its usage policy, and rephrasing it may help.',
    );
    expect(
      run_failure_sentence({ message: '400 content_policy_violation' }, self_hosted),
    ).not.toContain(doctor);
  });

  it.each([
    '400 registry.ollama.ai/library/gemma3:4b does not support tools',
    '400 "auto" tool choice requires --enable-auto-tool-choice and --tool-call-parser to be set',
    '500 tools param requires --jinja flag',
    '404 No endpoints found that support tool use. To learn more about provider routing, visit the docs.',
    '400 This model does not support function calling.',
  ])('says the model must support tool calling, and how to choose another: %s', (message) => {
    expect(run_failure_sentence({ message }, self_hosted)).toBe(
      'The model must support tool calling, and this one does not, so I could not answer. On the server, run ./alfera add model and choose a model that supports tool calling.',
    );
  });

  it('says the model reads no images, and what to do in the chat', () => {
    const failure = { message: 'openai_compatible/qwen3:14b does not support image input' };

    expect(run_failure_sentence(failure, self_hosted)).toBe(
      'The model of this install reads no images, so I could not answer. Send the message without the image.',
    );
  });

  it('never puts the raw cause in the chat', () => {
    const failure = { message: '401 Incorrect API key provided: sk-test-secret-value' };

    expect(run_failure_sentence(failure, self_hosted)).not.toContain('sk-test');
  });

  it('changes nothing on the hosted product', () => {
    const hosted = { is_self_hosted: false };

    expect(run_failure_sentence({ message: 'x', sandbox_started: false }, hosted)).toBe(
      runtime_failure_text,
    );
    expect(run_failure_sentence({ message: '401 unauthorized' }, hosted)).toBe(
      runtime_failure_text,
    );
    expect(run_failure_sentence({ message: '400 gemma does not support tools' }, hosted)).toBe(
      runtime_failure_text,
    );
  });
});

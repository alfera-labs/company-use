import {
  build_session_title_messages,
  fallback_session_title_from_messages,
  normalize_generated_session_title,
} from '@runtime-platform/orchestrator/session_title_prompt';
import { describe, expect, it } from 'vitest';

describe('session title prompt', () => {
  it('builds compact prompt messages from visible conversation turns', () => {
    const [message] = build_session_title_messages([
      user_message('Debug the Stripe OAuth callback after install'),
      assistant_message('The redirect URI is mismatched.'),
    ]);

    expect(message?.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('user: Debug the Stripe OAuth callback after install'),
    });
    expect(message?.content[0]).toMatchObject({
      text: expect.stringContaining('assistant: The redirect URI is mismatched.'),
    });
  });

  it('normalizes valid generated titles and rejects weak titles', () => {
    expect(normalize_generated_session_title('"Stripe OAuth Callback Debugging."')).toBe(
      'Stripe OAuth Callback Debugging',
    );
    expect(normalize_generated_session_title('Stripe')).toBeNull();
    expect(
      normalize_generated_session_title('A title with way too many words for this tiny field'),
    ).toBeNull();
  });

  it('falls back to the first user message in sentence case', () => {
    expect(fallback_session_title_from_messages([user_message('fix slack event ordering')])).toBe(
      'Fix slack event ordering',
    );
    expect(fallback_session_title_from_messages([user_message('ATO')])).toBe('ATO');
    expect(fallback_session_title_from_messages([user_message('💡')])).toBe('New chat');
  });

  it('cuts a long fallback title at a word boundary', () => {
    const title = fallback_session_title_from_messages([
      user_message('build me a website for my bakery and show a preview of the landing page'),
    ]);

    expect(title).toBe('Build me a website for my bakery and show a preview of the');
    expect(title.length).toBeLessThanOrEqual(60);
  });

  it('keeps the dots of a file name and drops the punctuation at the end', () => {
    expect(
      fallback_session_title_from_messages([user_message('read report.final.csv, then sum it.')]),
    ).toBe('Read report.final.csv, then sum it');
    expect(fallback_session_title_from_messages([user_message('résumé for Zoë?!')])).toBe(
      'Résumé for Zoë',
    );
  });
});

function user_message(text: string) {
  return { role: 'user' as const, text };
}

function assistant_message(text: string) {
  return { role: 'assistant' as const, text };
}

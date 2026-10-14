import { describe, expect, it } from 'vitest';
import {
  read_onboarding_opening_text,
  reveal_onboarding_opening,
} from '@/components/app/chat_onboarding_intro';
import type { ProjectedChatMessage } from '@/components/app/chat_stream_projection';

const opening: ProjectedChatMessage[] = [
  { id: 'm1', role: 'assistant', parts: [{ type: 'text', text: 'Hey there friend' }] },
];

describe('reveal_onboarding_opening', () => {
  it('shows nothing before the first word', () => {
    expect(reveal_onboarding_opening(opening, 0)).toEqual([]);
  });

  it('stops at a word boundary instead of mid-word', () => {
    expect(read_onboarding_opening_text(reveal_onboarding_opening(opening, 5))).toBe('Hey there');
  });

  it('shows the whole message once the count passes its length', () => {
    expect(read_onboarding_opening_text(reveal_onboarding_opening(opening, 99))).toBe(
      'Hey there friend',
    );
  });
});

import { describe, expect, it } from 'vitest';
import {
  access_a_new_account_starts_with,
  who_can_use_it_words,
} from '@/components/connections/connect_account_dialog';

describe('the connect dialog of a team-mode install', () => {
  it('starts with the account kept to the person who connects it', () => {
    expect(access_a_new_account_starts_with(true)).toBe('restricted');
    expect(access_a_new_account_starts_with(false)).toBe('shared');
  });

  it('says in one line who can use the account, and how to share it', () => {
    expect(who_can_use_it_words.restricted).toContain('Only you can use this account');
    expect(who_can_use_it_words.restricted).toContain('To share it');
    expect(who_can_use_it_words.shared).toContain('Everyone on the team');
  });
});

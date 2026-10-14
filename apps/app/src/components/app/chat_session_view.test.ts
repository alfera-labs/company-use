import { describe, expect, it, vi } from 'vitest';
import { selected_chat_session_id } from '@/components/app/chat_selected_session_id';

vi.mock('@/lib/auth_client', () => ({
  useAuth: () => ({ user: null }),
}));

describe('selected_chat_session_id', () => {
  it('keeps the route session id while the session list is still loading', () => {
    expect(selected_chat_session_id({ selectedSessionId: 'session_from_route' })).toBe(
      'session_from_route',
    );
  });

  it('uses the loaded session id when the session record is available', () => {
    expect(
      selected_chat_session_id({
        selectedSession: { session_id: 'session_from_list' },
        selectedSessionId: 'session_from_route',
      }),
    ).toBe('session_from_list');
  });
});

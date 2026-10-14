import { beforeEach, describe, expect, it } from 'vitest';
import {
  peek_chat_route_handoff_text,
  take_chat_route_handoff,
  write_chat_route_handoff,
} from '@/components/app/chat_route_handoff';

const handoff_key = 'coworker-chat-route-handoff';

describe('chat route handoff peek', () => {
  beforeEach(() => {
    install_session_storage();
  });

  it('reads the message the home composer handed off', () => {
    write_chat_route_handoff({ attachments: [], message_text: 'draft the Q3 update' });
    expect(peek_chat_route_handoff_text()).toBe('draft the Q3 update');
  });

  it('leaves the handoff in place for the real send to take', () => {
    write_chat_route_handoff({ attachments: [], message_text: 'book the flights' });
    peek_chat_route_handoff_text();
    peek_chat_route_handoff_text();
    expect(take_chat_route_handoff()?.message_text).toBe('book the flights');
    expect(peek_chat_route_handoff_text()).toBeNull();
  });

  it('keeps the selected project for the first chat send', () => {
    write_chat_route_handoff({
      attachments: [],
      message_text: 'Plan the launch',
      project_id: 'proj_launch',
    });

    expect(take_chat_route_handoff()).toMatchObject({ project_id: 'proj_launch' });
  });

  it('keeps an explicit personal selection for the first chat send', () => {
    write_chat_route_handoff({ attachments: [], message_text: 'Private note', project_id: null });

    expect(take_chat_route_handoff()).toMatchObject({ project_id: null });
  });

  it('reads handoffs written before projects were selectable', () => {
    window.sessionStorage.setItem(
      handoff_key,
      JSON.stringify({ attachments: [], created_time: Date.now(), message_text: 'Old draft' }),
    );

    expect(take_chat_route_handoff()).toEqual({ attachments: [], message_text: 'Old draft' });
  });

  it('rejects a malformed selected project', () => {
    window.sessionStorage.setItem(
      handoff_key,
      JSON.stringify({
        attachments: [],
        created_time: Date.now(),
        message_text: 'Bad project',
        project_id: 12,
      }),
    );

    expect(take_chat_route_handoff()).toBeNull();
  });

  it('returns null when nothing is waiting', () => {
    expect(peek_chat_route_handoff_text()).toBeNull();
  });

  it('ignores a stale handoff so an old draft never flashes on an unrelated navigation', () => {
    window.sessionStorage.setItem(
      handoff_key,
      JSON.stringify({ attachments: [], created_time: 0, message_text: 'from an hour ago' }),
    );
    expect(peek_chat_route_handoff_text()).toBeNull();
  });
});

function install_session_storage() {
  const stored_values = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      sessionStorage: {
        getItem: (key: string) => stored_values.get(key) ?? null,
        setItem: (key: string, value: string) => stored_values.set(key, value),
        removeItem: (key: string) => stored_values.delete(key),
      },
    },
  });
}

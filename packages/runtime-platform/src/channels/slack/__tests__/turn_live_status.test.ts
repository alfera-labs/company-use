import type { ChatStreamEvent } from '@coworker/shared';
import {
  create_slack_live_status,
  slack_status_for_event,
} from '@runtime-platform/channels/slack/turn_live_status';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const started = (item: Record<string, unknown>) =>
  ({ event_type: 'item_started', item }) as unknown as ChatStreamEvent;
const tool = (tool_name: string, extra: Record<string, unknown> = {}) =>
  started({ item_type: 'tool_call', tool_name, tool_kind: 'integration', ...extra });
const apps = async (node_key: string) => (node_key.startsWith('composio_gmail-') ? 'Gmail' : null);

describe('the words for a live step', () => {
  it('names a connected app by the name the catalog gives it', async () => {
    expect(
      await slack_status_for_event(
        tool('runtime-execute_tool-1', {
          input_data: { node_key: 'composio_gmail-list_messages-1' },
        }),
        apps,
      ),
    ).toBe('Working in Gmail…');
  });

  it("says Alfera's own steps by what they do", async () => {
    expect(await slack_status_for_event(tool('runtime-search_tools-1'), apps)).toBe(
      'Finding the right tool…',
    );
    expect(await slack_status_for_event(tool('runtime-run_program-1'), apps)).toBe(
      'Running a program…',
    );
    expect(
      await slack_status_for_event(tool('runtime-bash-1', { tool_kind: 'command' }), apps),
    ).toBe('Running a command…');
    expect(
      await slack_status_for_event(
        tool('runtime-fetch_url-1', {
          input_data: { url: 'https://www.example-salons.com/salon' },
        }),
        apps,
      ),
    ).toBe('Reading www.example-salons.com…');
  });

  it('says it is writing once the answer starts, and ignores what says nothing new', async () => {
    expect(await slack_status_for_event(started({ item_type: 'assistant_message' }), apps)).toBe(
      'Writing the answer…',
    );
    expect(
      await slack_status_for_event(
        { event_type: 'item_delta' } as unknown as ChatStreamEvent,
        apps,
      ),
    ).toBeNull();
    expect(await slack_status_for_event(tool('notifications-write_notification-1'), apps)).toBe(
      'Working…',
    );
  });

  it('says it is working when the app name lookup fails', async () => {
    const failing_lookup = () => Promise.reject(new Error('catalog down'));
    expect(await slack_status_for_event(tool('runtime-execute_tool-1'), failing_lookup)).toBe(
      'Working…',
    );
  });
});

describe('sending the status to Slack', () => {
  let clock = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    clock = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('sends the first step at once, holds quick ones back, and ends on the newest', async () => {
    const sent: string[] = [];
    const live = create_slack_live_status({
      set_status: async (status) => {
        sent.push(status);
      },
      app_name_for: apps,
      now: () => clock,
    });
    await live.on_event(tool('runtime-search_tools-1'));
    clock = 500;
    await live.on_event(tool('runtime-run_program-1'));
    clock = 900;
    await live.on_event(started({ item_type: 'assistant_message' }));
    expect(sent).toEqual(['Finding the right tool…']);
    clock = 2_000;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sent).toEqual(['Finding the right tool…', 'Writing the answer…']);
  });

  it('sends nothing after it is stopped, so no status lands after the answer', async () => {
    const sent: string[] = [];
    const live = create_slack_live_status({
      set_status: async (status) => {
        sent.push(status);
      },
      app_name_for: apps,
      now: () => clock,
    });
    await live.on_event(tool('runtime-search_tools-1'));
    clock = 100;
    await live.on_event(tool('runtime-run_program-1'));
    live.stop();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(sent).toEqual(['Finding the right tool…']);
  });
});

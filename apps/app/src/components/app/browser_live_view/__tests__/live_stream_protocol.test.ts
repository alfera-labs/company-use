import { describe, expect, it } from 'vitest';
import {
  build_live_view_ws_url,
  caption_for_activity,
  device_to_display,
  display_to_device,
  parse_stream_message,
  reconcile_tab_order,
} from '@/components/app/browser_live_view/live_stream_protocol';
import type { SandboxUrlPreview } from '@/lib/api';

function preview(overrides: Partial<SandboxUrlPreview>): SandboxUrlPreview {
  return {
    sandbox_url_preview_id: 'p',
    runtime_environment_id: 'rte_1',
    environment_provider: 'e2b',
    environment_status: 'running',
    preview_name: 'Browser live view',
    preview_url: 'https://4820-sandbox-1.e2b.app',
    preview_domain: '4820-sandbox-1.e2b.app',
    sandbox_key: 'sandbox_1',
    source: 'active',
    last_updated_time: '2026-09-07T00:00:00.000Z',
    preview_kind: 'browser_live_view',
    ...overrides,
  };
}

describe('build_live_view_ws_url', () => {
  it('turns the https preview into an authenticated wss stream url', () => {
    const url = build_live_view_ws_url(preview({ live_view_token: 'abc123' }), { max_fps: 30 });
    const parsed = new URL(url ?? '');
    expect(parsed.protocol).toBe('wss:');
    expect(parsed.host).toBe('4820-sandbox-1.e2b.app');
    expect(parsed.searchParams.get('token')).toBe('abc123');
    expect(parsed.searchParams.get('pacing')).toBe('push');
    expect(parsed.searchParams.get('maxFps')).toBe('30');
  });

  it('returns undefined without a token', () => {
    expect(build_live_view_ws_url(preview({ live_view_token: undefined }))).toBeUndefined();
  });
});

describe('parse_stream_message', () => {
  it('reads a frame with metadata', () => {
    const message = parse_stream_message(
      JSON.stringify({
        type: 'frame',
        seq: 4,
        data: 'AAAA',
        metadata: { deviceWidth: 800, deviceHeight: 600 },
      }),
    );
    expect(message).toEqual({
      type: 'frame',
      seq: 4,
      data: 'AAAA',
      metadata: { deviceWidth: 800, deviceHeight: 600 },
    });
  });

  it('reads tabs and drops malformed entries', () => {
    const message = parse_stream_message(
      JSON.stringify({
        type: 'tabs',
        tabs: [{ tabId: 't1', active: true, title: 'A', url: 'x' }, { active: true }],
      }),
    );
    expect(message).toEqual({
      type: 'tabs',
      tabs: [{ tabId: 't1', active: true, title: 'A', url: 'x' }],
    });
  });

  it('keeps protocol defaults and rejects malformed nested values', () => {
    expect(
      parse_stream_message(
        JSON.stringify({
          type: 'frame',
          data: 'AAAA',
          metadata: { deviceWidth: 'bad', deviceHeight: 600 },
        }),
      ),
    ).toEqual({ type: 'frame', data: 'AAAA', metadata: { deviceWidth: 1280, deviceHeight: 600 } });
    expect(
      parse_stream_message(
        JSON.stringify({ type: 'tabs', tabs: [null, [], { tabId: 't1', active: 'true' }] }),
      ),
    ).toEqual({ type: 'tabs', tabs: [{ tabId: 't1', active: false, title: '', url: '' }] });
    expect(
      parse_stream_message(JSON.stringify({ type: 'command', action: 'open', params: [] })),
    ).toEqual({ type: 'command', action: 'open' });
  });

  it('reads a pointer down with an element name', () => {
    expect(
      parse_stream_message(
        JSON.stringify({ type: 'pointer', kind: 'down', x: 12, y: 34, name: 'Match to invoice' }),
      ),
    ).toEqual({
      type: 'pointer',
      kind: 'down',
      x: 12,
      y: 34,
      name: 'Match to invoice',
    });
  });

  it('ignores unparseable or unknown messages', () => {
    expect(parse_stream_message('not json')).toBeUndefined();
    expect(parse_stream_message(JSON.stringify({ type: 'console', text: 'hi' }))).toBeUndefined();
  });

  it('reads a control result, including a refusal', () => {
    expect(
      parse_stream_message(
        JSON.stringify({
          type: 'control_result',
          id: '3',
          action: 'tab_close',
          ok: false,
          error: 'no such tab',
        }),
      ),
    ).toEqual({
      type: 'control_result',
      id: '3',
      action: 'tab_close',
      ok: false,
      error: 'no such tab',
    });
  });
});

describe('reconcile_tab_order', () => {
  const tab = (tabId: string) => ({ tabId, active: false, title: '', url: '' });

  it('keeps the user order, appends new tabs, drops closed ones', () => {
    expect(reconcile_tab_order(['t2', 't1'], [tab('t1'), tab('t2'), tab('t3')])).toEqual([
      't2',
      't1',
      't3',
    ]);
    expect(reconcile_tab_order(['t2', 't1', 't3'], [tab('t1'), tab('t3')])).toEqual(['t1', 't3']);
  });

  it('starts from the browser order when there is no prior order', () => {
    expect(reconcile_tab_order([], [tab('t1'), tab('t2')])).toEqual(['t1', 't2']);
  });
});

describe('caption_for_activity', () => {
  it('names the clicked element when known', () => {
    expect(caption_for_activity({ action: 'click', target_name: 'Match to invoice' })).toBe(
      'Clicking Match to invoice',
    );
  });

  it('names the host on navigation', () => {
    expect(caption_for_activity({ action: 'open', url: 'https://www.netsuite.com/app' })).toBe(
      'Opening netsuite.com',
    );
  });

  it('falls back to a verb for a bare action', () => {
    expect(caption_for_activity({ action: 'scroll' })).toBe('Scrolling');
    expect(caption_for_activity({ action: 'tab_new' })).toBe('Opening a new tab');
  });
});

describe('coordinate mapping', () => {
  it('maps a display click back to device pixels', () => {
    expect(
      display_to_device(
        { x: 320, y: 180 },
        { width: 640, height: 360 },
        { width: 1280, height: 720 },
      ),
    ).toEqual({ x: 640, y: 360 });
  });

  it('maps an agent device point forward to the display', () => {
    expect(
      device_to_display(
        { x: 640, y: 360 },
        { width: 1280, height: 720 },
        { width: 640, height: 360 },
      ),
    ).toEqual({ x: 320, y: 180 });
  });
});

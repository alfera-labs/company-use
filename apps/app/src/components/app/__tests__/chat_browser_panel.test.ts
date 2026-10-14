import { describe, expect, it } from 'vitest';
import {
  browser_preview_poll_interval,
  find_browser_live_view,
  find_run_browser_live_view,
  is_waiting_for_new_run,
  without_browser_live_view,
} from '@/components/app/chat_browser_panel';
import type { SandboxUrlPreview } from '@/lib/api';

const app_preview = create_preview('preview:app');
const browser_preview = create_preview('preview:browser', 'browser_live_view');

describe('browser live view selection', () => {
  it('finds the browser dashboard preview', () => {
    expect(find_browser_live_view([app_preview, browser_preview])).toBe(browser_preview);
  });

  it('does not show an inline card for a manually opened preview', () => {
    expect(find_run_browser_live_view([browser_preview], undefined, [])).toBeUndefined();
    expect(find_run_browser_live_view([browser_preview], 'run:1', [])).toBeUndefined();
  });

  it('ignores non-browser tools and browser calls that did not execute', () => {
    expect(
      find_run_browser_live_view([browser_preview], 'run:1', [
        { run_id: 'run:1', tool_name: 'web_search', tool_status: 'completed' },
        { run_id: 'run:1', tool_name: 'browser', tool_status: 'pending' },
        { run_id: 'run:1', tool_name: 'browse', tool_status: 'awaiting_approval' },
      ]),
    ).toBeUndefined();
  });

  it.each([
    'browser',
    'browse',
    'agent-browser',
  ])('shows a running %s call before its result', (tool_name) => {
    expect(
      find_run_browser_live_view([browser_preview], 'run:1', [
        { run_id: 'run:1', tool_name, tool_status: 'running' },
      ]),
    ).toBe(browser_preview);
  });

  it.each([
    'executing',
    'completed',
    'failed',
  ])('keeps the card for a browser call with status %s', (tool_status) => {
    expect(
      find_run_browser_live_view([browser_preview], 'run:1', [
        { run_id: 'run:1', tool_name: 'browser', tool_status },
      ]),
    ).toBe(browser_preview);
  });

  it('does not carry browser activity into an unrelated later run', () => {
    expect(
      find_run_browser_live_view([browser_preview], 'run:2', [
        { run_id: 'run:1', tool_name: 'browser', tool_status: 'completed' },
        { run_id: 'run:2', tool_name: 'web_search', tool_status: 'running' },
      ]),
    ).toBeUndefined();
  });

  it('hides the previous run card while a new run is pending', () => {
    expect(
      find_run_browser_live_view(
        [browser_preview],
        'run:1',
        [{ run_id: 'run:1', tool_name: 'browser', tool_status: 'completed' }],
        true,
      ),
    ).toBeUndefined();
  });

  it('shows a card when the new run starts using the browser', () => {
    expect(
      find_run_browser_live_view(
        [browser_preview],
        'run:2',
        [{ run_id: 'run:2', tool_name: 'browser', tool_status: 'running' }],
        false,
      ),
    ).toBe(browser_preview);
  });

  it('stops waiting when the pending send receives its new run', () => {
    expect(is_waiting_for_new_run(true, 'run:1', 'run:1')).toBe(true);
    expect(is_waiting_for_new_run(true, 'run:2', 'run:1')).toBe(false);
    expect(is_waiting_for_new_run(false, 'run:1', 'run:1')).toBe(false);
  });

  it('keeps the browser dashboard out of external preview links', () => {
    expect(without_browser_live_view([app_preview, browser_preview])).toEqual([app_preview]);
  });

  it('polls previews fast only while the streaming run uses a browser', () => {
    expect(browser_preview_poll_interval(false, true, false, true)).toBe(500);
    expect(browser_preview_poll_interval(true, false, false, true)).toBe(500);
    expect(browser_preview_poll_interval(true, false, true, true)).toBe(2000);
    expect(browser_preview_poll_interval(false, false, true, true)).toBe(false);
    expect(browser_preview_poll_interval(true, false, false, false)).toBe(false);
  });
});

function create_preview(id: string, preview_kind?: 'browser_live_view'): SandboxUrlPreview {
  return {
    sandbox_url_preview_id: id,
    runtime_environment_id: 'rte_1',
    environment_provider: 'e2b',
    environment_status: 'running',
    preview_name: 'Preview',
    preview_url: 'https://preview.example.com',
    preview_domain: 'preview.example.com',
    sandbox_key: 'sandbox_1',
    source: 'active',
    last_updated_time: '2026-07-25T00:00:00.000Z',
    ...(preview_kind ? { preview_kind } : {}),
  };
}

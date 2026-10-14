import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { is_lookup_tool_name, LookupToolPartRow } from '@/components/app/lookup_tool_part_row';
import {
  chat_lookback_labels,
  is_chat_lookback_tool_name,
  read_lookup_tool_tense,
} from '@/components/app/lookup_tool_words';

function render_row(part: { state: string; errorText?: string }, is_run_active: boolean) {
  return renderToStaticMarkup(
    createElement(LookupToolPartRow, {
      isRunActive: is_run_active,
      part: { toolName: 'runtime-search_context-1', ...part },
    }),
  );
}

describe('the row of the tool that looks back through the chat', () => {
  it('is the row of every version of runtime-search_context, and of no other tool', () => {
    expect(is_chat_lookback_tool_name('runtime-search_context-1')).toBe(true);
    expect(is_chat_lookback_tool_name('runtime-search_context-12')).toBe(true);
    expect(is_lookup_tool_name('runtime-search_context-1')).toBe(true);
    expect(is_chat_lookback_tool_name('runtime-web_search-1')).toBe(false);
    expect(is_chat_lookback_tool_name('search_context')).toBe(false);
    expect(is_lookup_tool_name('runtime-execute_tool-1')).toBe(false);
  });

  it('says what it does in the tense the call is in', () => {
    expect(chat_lookback_labels).toEqual({
      running: 'Looking back through this chat',
      done: 'Looked back through this chat',
      failed: 'Could not look back through this chat',
      attempted: 'Tried to look back through this chat',
    });
    expect(render_row({ state: 'running' }, true)).toContain('Looking back through this chat');
    expect(render_row({ state: 'running' }, false)).toContain(
      'Tried to look back through this chat',
    );
    expect(render_row({ state: 'completed' }, false)).toContain('Looked back through this chat');
  });

  it('shows the error of a failed call, and cannot be opened', () => {
    const html = render_row({ state: 'failed', errorText: 'The search timed out.' }, false);

    expect(html).toContain('Could not look back through this chat');
    expect(html).toContain('The search timed out.');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('aria-expanded');
  });
});

describe('read_lookup_tool_tense', () => {
  it('reads running only while the run is active', () => {
    expect(read_lookup_tool_tense({ state: 'running', is_run_active: true })).toBe('running');
    expect(read_lookup_tool_tense({ state: 'running', is_run_active: false })).toBe('attempted');
  });

  it('reads failed from an error text or a failed state, and done from a finished state', () => {
    expect(
      read_lookup_tool_tense({ state: 'completed', error_text: 'no', is_run_active: false }),
    ).toBe('failed');
    expect(read_lookup_tool_tense({ state: 'timed_out', is_run_active: true })).toBe('failed');
    expect(read_lookup_tool_tense({ state: 'succeeded', is_run_active: false })).toBe('done');
  });

  it('reads a call the person stopped as tried, not as failed', () => {
    const stopped = { state: 'cancelled', error_text: 'Stopped before it finished.' };

    expect(read_lookup_tool_tense({ ...stopped, is_run_active: false })).toBe('attempted');
    expect(read_lookup_tool_tense({ ...stopped, is_run_active: true })).toBe('attempted');
  });
});

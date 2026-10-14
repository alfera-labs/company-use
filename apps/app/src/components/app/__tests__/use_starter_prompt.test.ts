// @vitest-environment happy-dom

import { act, createElement, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const write_text_as_if_typing = vi.hoisted(() => vi.fn());
vi.mock('@/components/app/type_text_into_composer', async (original) => {
  const actual = await original<typeof import('@/components/app/type_text_into_composer')>();
  write_text_as_if_typing.mockImplementation(actual.write_text_as_if_typing);
  return { write_text_as_if_typing };
});

import { use_starter_prompt } from '@/components/app/use_starter_prompt';

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function Composer({
  starter_prompt,
  typed,
  other_update_first = false,
}: {
  starter_prompt: string | null;
  typed: string;
  other_update_first?: boolean;
}) {
  const [message_text, set_message_text] = useState(typed);
  const [, set_other] = useState(0);
  useEffect(() => {
    if (other_update_first) set_other((count) => count + 1);
  }, [other_update_first]);
  use_starter_prompt({ starter_prompt, message_text, set_message_text });
  return createElement('output', null, message_text);
}

function mount(props: {
  starter_prompt: string | null;
  typed: string;
  other_update_first?: boolean;
}) {
  act(() => root.render(createElement(Composer, props)));
}

function composer_text() {
  return container.querySelector('output')?.textContent ?? '';
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  write_text_as_if_typing.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('a starter prompt', () => {
  it('is typed into an empty composer, not pasted', () => {
    mount({ starter_prompt: 'Help me set up a new automation', typed: '' });
    expect(write_text_as_if_typing).toHaveBeenCalledOnce();
    expect(write_text_as_if_typing.mock.calls[0]?.[0]).toMatchObject({
      full_text: 'Help me set up a new automation',
    });
  });

  it('leaves what the person already typed alone', () => {
    mount({ starter_prompt: 'Help me set up a new automation', typed: 'my own words' });
    expect(write_text_as_if_typing).not.toHaveBeenCalled();
    expect(composer_text()).toBe('my own words');
  });

  it('leaves typed text alone even when another update is waiting in the same commit', () => {
    mount({ starter_prompt: 'Help me', typed: 'my own words', other_update_first: true });
    expect(write_text_as_if_typing).not.toHaveBeenCalled();
    expect(composer_text()).toBe('my own words');
  });

  it('lands at once for a person who asked for reduced motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({ matches: query.includes('reduce'), media: query })),
    );
    mount({ starter_prompt: 'Help me set up a new automation', typed: '' });
    expect(composer_text()).toBe('Help me set up a new automation');
  });
});

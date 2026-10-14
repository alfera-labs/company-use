// @vitest-environment happy-dom

import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ChatConversation } from '@/components/app/chat_conversation';
import { chat_user_message_class_name } from '@/components/app/chat_message';

vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children?: ReactNode }) => createElement('a', null, children),
}));

function bubble_of_the_person(typed_text: string) {
  const page = document.createElement('div');
  page.innerHTML = renderToStaticMarkup(
    createElement(ChatConversation, {
      isSubmitting: false,
      messages: [{ id: 'msg_user', role: 'user', parts: [{ type: 'text', text: typed_text }] }],
    }),
  );
  const bubble = [...page.querySelectorAll('div')].find(
    (element) => element.className === chat_user_message_class_name,
  );
  if (!bubble) throw new Error("The person's bubble did not render");
  return bubble;
}

describe("the person's own chat bubble", () => {
  it.each([
    'cat </dev/tcp/example.com/80',
    'Why does List<String> not compile?',
    'Use <b>tag</b> here',
    'if a < b && c > d then stop',
    '<script>alert(1)</script> is what I pasted',
    'Compare <details><summary>one</summary>two</details> and <img src=x onerror=alert(1)>',
    'a &amp; b &lt; c',
    'Run `List<String> names` and 2 * 3 * 4 with __init__',
    'first line\n\n- a list item\n# not a heading',
  ])('shows exactly what was typed: %s', (typed_text) => {
    expect(bubble_of_the_person(typed_text).textContent).toBe(typed_text);
  });

  it('makes no element out of a tag the person typed', () => {
    const bubble = bubble_of_the_person('Use <b>tag</b> and <img src=x> here');

    expect(bubble.querySelector('b, img')).toBeNull();
  });

  it('keeps the line breaks the person typed', () => {
    const bubble = bubble_of_the_person('first line\nsecond line');

    expect(bubble.querySelector('p')?.className).toContain('whitespace-pre-wrap');
  });
});

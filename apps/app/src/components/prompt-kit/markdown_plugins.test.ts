import { describe, expect, it, vi } from 'vitest';

describe('the markdown plugin store', () => {
  async function load_store() {
    vi.resetModules();
    return import('@/components/prompt-kit/markdown_plugins');
  }

  describe('deciding which heavy plugins a message needs', () => {
    it('asks for nothing on prose', async () => {
      const { markdown_plugins_needed } = await load_store();

      expect(markdown_plugins_needed('Just a sentence about $5 and a price.')).toEqual([]);
      expect(markdown_plugins_needed('A list:\n- one\n- two')).toEqual([]);
      expect(markdown_plugins_needed('Inline `code` needs no highlighter.')).toEqual([]);
    });

    it('asks only for the highlighter on a plain code fence', async () => {
      const { markdown_plugins_needed } = await load_store();

      expect(markdown_plugins_needed('```ts\nconst a = 1;\n```')).toEqual(['code']);
      expect(markdown_plugins_needed('~~~py\nprint(1)\n~~~')).toEqual(['code']);
    });

    it('asks only for math on a formula', async () => {
      const { markdown_plugins_needed } = await load_store();

      expect(markdown_plugins_needed('The formula $$e=mc^2$$ holds.')).toEqual(['math']);
      expect(markdown_plugins_needed('Inline \\(x^2\\) math.')).toEqual(['math']);
    });

    it('asks for the diagram plugin and the highlighter on a mermaid fence', async () => {
      const { markdown_plugins_needed } = await load_store();

      expect(markdown_plugins_needed('```mermaid\ngraph TD;\n```')).toEqual(['code', 'mermaid']);
    });

    it('widens as a reply streams in', async () => {
      const { markdown_plugins_needed } = await load_store();

      expect(markdown_plugins_needed('Here you go:\n```ts\nconst a =')).toEqual(['code']);
      expect(markdown_plugins_needed('Here you go:\n```mermaid\ngraph')).toEqual([
        'code',
        'mermaid',
      ]);
    });
  });

  describe('loading the heavy plugins', () => {
    it('renders text-only plugins before anything is subscribed', async () => {
      const store = await load_store();

      const plugins = store.read_markdown_plugins();
      expect(plugins.cjk).toBeDefined();
      expect(plugins.code).toBeUndefined();
      expect(plugins.mermaid).toBeUndefined();
      expect(plugins.math).toBeUndefined();
    });

    it('never changes the plugins a prose message sees', async () => {
      const store = await load_store();
      const on_change = vi.fn();

      const unsubscribe = store.subscribe_to_text_markdown_plugins(on_change);
      store.subscribe_to_markdown_plugins(vi.fn());
      store.request_markdown_plugins(['code', 'math', 'mermaid']);
      await vi.waitFor(() => expect(store.read_markdown_plugins().code).toBeDefined());

      expect(on_change).not.toHaveBeenCalled();
      expect(store.read_text_markdown_plugins().code).toBeUndefined();
      expect(unsubscribe).toBeTypeOf('function');
      unsubscribe();
    });

    it('adds the heavy plugins once they load and tells subscribers', async () => {
      const store = await load_store();
      const on_change = vi.fn();

      store.subscribe_to_markdown_plugins(on_change);
      store.request_markdown_plugins(['code', 'math', 'mermaid']);
      await vi.waitFor(() => expect(on_change).toHaveBeenCalled());

      const plugins = store.read_markdown_plugins();
      expect(plugins.cjk).toBeDefined();
      expect(plugins.code).toBeDefined();
      expect(plugins.math).toBeDefined();
      expect(plugins.mermaid).toBeDefined();
    });

    it('holds the same plugin object across reads so Streamdown does not re-parse', async () => {
      const store = await load_store();
      store.subscribe_to_markdown_plugins(vi.fn());
      store.request_markdown_plugins(['code', 'math', 'mermaid']);
      await vi.waitFor(() => expect(store.read_markdown_plugins().code).toBeDefined());

      expect(store.read_markdown_plugins()).toBe(store.read_markdown_plugins());
    });

    it('notifies every mounted message, not just the first one', async () => {
      const store = await load_store();
      const first = vi.fn();
      const second = vi.fn();

      store.subscribe_to_markdown_plugins(first);
      store.subscribe_to_markdown_plugins(second);
      store.request_markdown_plugins(['code']);
      await vi.waitFor(() => {
        expect(first).toHaveBeenCalled();
        expect(second).toHaveBeenCalled();
      });
    });

    it('stops notifying a message once it unsubscribes', async () => {
      const store = await load_store();
      const on_change = vi.fn();

      store.subscribe_to_markdown_plugins(on_change)();
      store.request_markdown_plugins(['code']);
      await vi.waitFor(() => expect(store.read_markdown_plugins().code).toBeDefined());

      expect(on_change).not.toHaveBeenCalled();
    });

    it('keeps the plugins that loaded when one chunk fails, and retries only that one', async () => {
      vi.resetModules();
      let mermaid_attempts = 0;
      vi.doMock('@streamdown/mermaid', () => {
        mermaid_attempts += 1;
        if (mermaid_attempts === 1) throw new Error('failed to fetch dynamically imported module');
        return { mermaid: { name: 'mermaid' } };
      });

      const store = await import('@/components/prompt-kit/markdown_plugins');
      store.subscribe_to_markdown_plugins(vi.fn());
      store.request_markdown_plugins(['code', 'math', 'mermaid']);

      await vi.waitFor(() => expect(store.read_markdown_plugins().code).toBeDefined());
      expect(store.read_markdown_plugins().math).toBeDefined();
      expect(store.read_markdown_plugins().mermaid).toBeUndefined();

      store.request_markdown_plugins(['mermaid']);
      await vi.waitFor(() => expect(store.read_markdown_plugins().mermaid).toBeDefined());
      expect(mermaid_attempts).toBe(2);
      vi.doUnmock('@streamdown/mermaid');
    });
  });
});

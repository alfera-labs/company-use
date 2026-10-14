import * as Sentry from '@sentry/tanstackstart-react';
import { cjk } from '@streamdown/cjk';
import type { PluginConfig } from 'streamdown';

const text_plugins: PluginConfig = { cjk };

type RichPluginName = 'code' | 'math' | 'mermaid';

const rich_plugins: Record<
  RichPluginName,
  { needed_when: RegExp; load: () => Promise<PluginConfig> }
> = {
  code: {
    needed_when: /```|~~~/,
    load: () => import('@streamdown/code').then((module) => ({ code: module.code })),
  },
  math: {
    needed_when: /\$\$|\\\(|\\\[/,
    load: () => import('@streamdown/math').then((module) => ({ math: module.math })),
  },
  mermaid: {
    needed_when: /(?:```|~~~)\s*mermaid\b/i,
    load: () => import('@streamdown/mermaid').then((module) => ({ mermaid: module.mermaid })),
  },
};

const rich_plugin_names = Object.keys(rich_plugins) as RichPluginName[];

export function markdown_plugins_needed(markdown: string): RichPluginName[] {
  return rich_plugin_names.filter((name) => rich_plugins[name].needed_when.test(markdown));
}

let current_plugins: PluginConfig = text_plugins;
const requested_plugins = new Set<RichPluginName>();
const subscribers = new Set<() => void>();

export function subscribe_to_markdown_plugins(on_change: () => void) {
  subscribers.add(on_change);
  return () => {
    subscribers.delete(on_change);
  };
}

export function read_markdown_plugins(): PluginConfig {
  return current_plugins;
}

export function subscribe_to_text_markdown_plugins(_on_change: () => void) {
  return no_markdown_plugin_change;
}

export function read_text_markdown_plugins(): PluginConfig {
  return text_plugins;
}

function no_markdown_plugin_change() {}

export function request_markdown_plugins(names: readonly RichPluginName[]) {
  const pending = names.filter((name) => !requested_plugins.has(name));
  if (pending.length === 0) return;
  for (const name of pending) requested_plugins.add(name);

  void Promise.allSettled(pending.map((name) => rich_plugins[name].load())).then((results) => {
    let next_plugins = current_plugins;

    results.forEach((result, index) => {
      const name = pending[index];
      if (result.status === 'fulfilled') {
        next_plugins = { ...next_plugins, ...result.value };
        return;
      }
      if (name) requested_plugins.delete(name);
      Sentry.captureException(result.reason, {
        tags: { markdown_plugin: name ?? 'unknown' },
      });
    });

    if (next_plugins === current_plugins) return;

    current_plugins = next_plugins;
    for (const on_change of subscribers) on_change();
  });
}

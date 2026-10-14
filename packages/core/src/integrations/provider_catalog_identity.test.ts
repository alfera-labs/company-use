import {
  build_provider_app_names,
  fit_node_name,
  preserve_provider_node_names,
} from '@coworker/core/integrations/provider_catalog_identity';
import { describe, expect, it } from 'vitest';

const legacy_options = { collision_prefix: 'legacy_' };

describe('provider catalog app identity', () => {
  it('separates provider apps from native apps without changing ordinary safe slugs', () => {
    const names = build_provider_app_names(['slack', 'linear'], new Set(['slack']), legacy_options);

    expect(names.get('slack')).toBe('legacy_slack');
    expect(names.get('linear')).toBe('linear');
  });

  it('adds provider-derived suffixes for lossy, colliding, and oversized names', () => {
    const long_slug = 'a'.repeat(60);
    const names = build_provider_app_names(
      ['foo-bar', 'foo_bar', long_slug],
      new Set<string>(),
      legacy_options,
    );

    expect(names.get('foo-bar')).toMatch(/^foo_bar_[a-f0-9]{8}$/u);
    expect(names.get('foo_bar')).toMatch(/^foo_bar_[a-f0-9]{8}$/u);
    expect(names.get('foo-bar')).not.toBe(names.get('foo_bar'));
    expect(names.get(long_slug)).toHaveLength(49);
  });

  it('does not rebind a provider name that already belongs to a native app', () => {
    const names = build_provider_app_names(
      ['slack'],
      new Set(['slack', 'legacy_slack']),
      legacy_options,
    );

    expect(names.get('slack')).toMatch(/^legacy_slack_[a-f0-9]{8}$/u);
  });

  it('prefixes with the caller-supplied collision prefix', () => {
    const names = build_provider_app_names(['slack'], new Set(['slack']), {
      collision_prefix: 'composio_',
    });

    expect(names.get('slack')).toBe('composio_slack');
  });

  it('preserves a migrated node name by provider component identity', () => {
    const seeds = [node_identity('new_collision_suffix', 'slack-send-message')];
    const existing_nodes = [
      {
        ...node_identity('legacy_collision_suffix', 'slack-send-message'),
        node_version: 3,
      },
    ];

    expect(preserve_provider_node_names(seeds, existing_nodes)).toEqual([
      node_identity('legacy_collision_suffix', 'slack-send-message'),
    ]);
  });

  it('refuses to reuse a node name owned by another provider component', () => {
    const seeds = [node_identity('send_message', 'slack-send-message-v2')];
    const existing_nodes = [
      { ...node_identity('send_message', 'slack-send-message'), node_version: 1 },
    ];

    expect(() => preserve_provider_node_names(seeds, existing_nodes)).toThrow(
      'Refusing to rebind node_name send_message from slack-send-message to slack-send-message-v2',
    );
  });

  it('fits proxy names into the remaining node-key budget for maximum-length app names', () => {
    const node_name = fit_node_name('get_api_proxy', 'legacy:api_proxy:get', 10);

    expect(node_name).toMatch(/^[a-z0-9_]{10}$/u);
  });
});

function node_identity(node_name: string, provider_component_id: string) {
  return {
    node_name,
    node_config: {
      sourced_from: {
        provider: 'legacy',
        provider_component_id,
      },
    },
  };
}

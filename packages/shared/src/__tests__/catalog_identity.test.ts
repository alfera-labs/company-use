import {
  build_node_key,
  catalog_app_name_max_length,
  catalog_node_version_maximum,
  maximum_node_name_length,
  model_tool_name_max_length,
  normalize_machine_name,
  validate_model_tool_name,
} from '@coworker/shared';
import { describe, expect, it } from 'vitest';

describe('catalog identity', () => {
  it('normalizes machine names with an explicit length boundary', () => {
    expect(normalize_machine_name(' Google Sheets ')).toBe('google_sheets');
    expect(
      normalize_machine_name('a'.repeat(80), { maximum_length: catalog_app_name_max_length }),
    ).toHaveLength(catalog_app_name_max_length);
  });

  it('rejects names that normalize to empty', () => {
    expect(() => normalize_machine_name('🔥')).toThrow('Machine name is empty');
  });

  it('builds one provider-safe versioned node key', () => {
    const maximum_length = maximum_node_name_length('google_sheets', catalog_node_version_maximum);
    const node_name = 'a'.repeat(maximum_length);
    const node_key = build_node_key({
      app_name: 'google_sheets',
      node_name,
      node_version: catalog_node_version_maximum,
    });

    expect(node_key).toHaveLength(model_tool_name_max_length);
    expect(validate_model_tool_name(node_key)).toBe(node_key);
  });

  it('rejects invalid and oversized tool names', () => {
    expect(() =>
      build_node_key({ app_name: 'google-sheets', node_name: 'read', node_version: 1 }),
    ).toThrow('app_name must match');
    expect(() => validate_model_tool_name('sandbox.read')).toThrow('Tool name must use');
    expect(() => validate_model_tool_name('a'.repeat(65))).toThrow('exceeds 64');
  });
});

import { describe, expect, it } from 'vitest';
import {
  default_settings_section,
  find_active_settings_section,
  find_settings_section,
  is_settings_path,
  settings_group_definitions,
  settings_section_definitions,
  settings_section_path,
} from '@/lib/settings_navigation';

describe('settings navigation', () => {
  it('gives every section a unique id', () => {
    const ids = settings_section_definitions.map((section) => section.section_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('puts every section in a group the sidebar renders', () => {
    const group_ids = new Set(settings_group_definitions.map((group) => group.group_id));
    const orphans = settings_section_definitions
      .filter((section) => !group_ids.has(section.group))
      .map((section) => section.section_id);
    expect(orphans).toEqual([]);
  });

  it('has no empty group', () => {
    const used = new Set(settings_section_definitions.map((section) => section.group));
    const empty = settings_group_definitions
      .filter((group) => !used.has(group.group_id))
      .map((group) => group.group_id);
    expect(empty).toEqual([]);
  });

  it('derives the path from the id so the two cannot drift', () => {
    for (const section of settings_section_definitions) {
      expect(settings_section_path(section.section_id)).toBe(`/settings/${section.section_id}`);
    }
  });

  it('resolves a known section', () => {
    expect(find_settings_section('models').title).toBe('Models');
    expect(find_settings_section('team').section_id).toBe('team');
  });

  it('falls back to the first section for no section and for an unknown one', () => {
    expect(find_settings_section(undefined)).toBe(default_settings_section);
    expect(find_settings_section('retired-section')).toBe(default_settings_section);
  });

  it('resolves the active section from a pathname', () => {
    expect(find_active_settings_section('/settings/models').section_id).toBe('models');
    expect(find_active_settings_section('/settings/api-keys').section_id).toBe('api-keys');
    expect(find_active_settings_section('/settings')).toBe(default_settings_section);
    expect(find_active_settings_section('/settings/gone')).toBe(default_settings_section);
    expect(find_active_settings_section('/chats')).toBe(default_settings_section);
  });

  it('recognises the settings surface without matching a lookalike route', () => {
    expect(is_settings_path('/settings')).toBe(true);
    expect(is_settings_path('/settings/models')).toBe(true);
    expect(is_settings_path('/settings-export')).toBe(false);
    expect(is_settings_path('/chats')).toBe(false);
  });
});

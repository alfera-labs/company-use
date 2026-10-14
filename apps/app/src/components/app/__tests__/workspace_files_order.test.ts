import { describe, expect, it } from 'vitest';
import {
  is_hidden_workspace_entry,
  order_workspace_listing,
} from '@/components/app/workspace_files_order';

const host_root = {
  folders: [
    { folder_name: '.venv', description: null, is_empty: false },
    { folder_name: 'companies', description: 'one page per company', is_empty: true },
    { folder_name: 'files', description: 'what the agent produced or downloaded', is_empty: true },
    { folder_name: 'outputs', description: null, is_empty: false },
    { folder_name: 'people', description: 'one page per person', is_empty: true },
    { folder_name: 'tmp', description: null, is_empty: true },
  ],
  files: [
    { file_name: '.env', byte_size: 9, last_modified_time: '2026-10-12T09:00:00.000Z' },
    { file_name: 'notes.md', byte_size: 12, last_modified_time: '2026-10-10T08:00:00.000Z' },
    { file_name: 'plan.md', byte_size: 40, last_modified_time: '2026-10-12T08:00:00.000Z' },
    { file_name: 'undated.csv', byte_size: 3, last_modified_time: null },
  ],
};

const default_view = { folder_path: '', name_filter: '', show_hidden: false };

function names(shown: ReturnType<typeof order_workspace_listing>) {
  return {
    folders: shown.folders.map((folder) => folder.folder_name),
    files: shown.files.map((file) => file.file_name),
    empty_folders: shown.empty_folders.map((folder) => folder.folder_name),
  };
}

describe('the order of a folder in the Files panel', () => {
  it('hides dot names and the scratch folder, and puts the empty starter folders last', () => {
    const shown = order_workspace_listing(host_root, default_view);

    expect(names(shown)).toEqual({
      folders: ['outputs'],
      files: ['plan.md', 'notes.md', 'undated.csv'],
      empty_folders: ['companies', 'files', 'people'],
    });
    expect(shown.hidden_count).toBe(3);
  });

  it('shows every name when the person asks for hidden items', () => {
    const shown = order_workspace_listing(host_root, { ...default_view, show_hidden: true });

    expect(names(shown)).toEqual({
      folders: ['.venv', 'outputs'],
      files: ['.env', 'plan.md', 'notes.md', 'undated.csv'],
      empty_folders: ['companies', 'files', 'people', 'tmp'],
    });
  });

  it('keeps a folder that does not say if it is empty where it is today', () => {
    const cloud_root = {
      folders: [
        { folder_name: 'files', description: null },
        { folder_name: 'skills', description: null },
      ],
      files: [],
    };

    expect(names(order_workspace_listing(cloud_root, default_view))).toEqual({
      folders: ['files', 'skills'],
      files: [],
      empty_folders: [],
    });
  });

  it('hides the scratch folder only at the top of the workspace', () => {
    expect(is_hidden_workspace_entry('tmp', '')).toBe(true);
    expect(is_hidden_workspace_entry('tmp', 'outputs')).toBe(false);
    expect(is_hidden_workspace_entry('.cache', 'outputs')).toBe(true);
    expect(is_hidden_workspace_entry('template.md', '')).toBe(false);
  });

  it('filters by name on top of the hidden rule', () => {
    const shown = order_workspace_listing(host_root, { ...default_view, name_filter: ' P ' });

    expect(names(shown)).toEqual({
      folders: ['outputs'],
      files: ['plan.md'],
      empty_folders: ['companies', 'people'],
    });
  });
});

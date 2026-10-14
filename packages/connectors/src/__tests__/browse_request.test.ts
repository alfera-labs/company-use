import { evaluate_browse_request, fill_browse_template } from '@connectors/browse_request';
import { list_template_placeholders } from '@connectors/sync_definition/check_sync_extensions';
import { describe, expect, it } from 'vitest';

const drive_q_request = {
  q: {
    $default: [
      "'{parent_id}' in parents and name contains '{query}' and trashed = false",
      "'{parent_id}' in parents and trashed = false",
      "name contains '{query}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      {
        $literal:
          "'root' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
      },
    ],
  },
};

describe('evaluate_browse_request', () => {
  it('answers the root listing when nothing is set', () => {
    expect(evaluate_browse_request(drive_q_request, {})).toEqual({
      q: "'root' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    });
  });

  it('answers the drill listing when a parent is set', () => {
    expect(evaluate_browse_request(drive_q_request, { parent_id: 'folder_1' })).toEqual({
      q: "'folder_1' in parents and trashed = false",
    });
  });

  it('answers the searched drill when parent and query are both set', () => {
    expect(
      evaluate_browse_request(drive_q_request, { parent_id: 'folder_1', query: 'roadmap' }),
    ).toEqual({
      q: "'folder_1' in parents and name contains 'roadmap' and trashed = false",
    });
  });

  it('answers the tree-wide folder search when only a query is set', () => {
    expect(evaluate_browse_request(drive_q_request, { query: 'roadmap' })).toEqual({
      q: "name contains 'roadmap' and mimeType = 'application/vnd.google-apps.folder' and trashed = false",
    });
  });

  it('drops a field whose expression answers nothing', () => {
    expect(evaluate_browse_request({ folder: '{parent_id}', fixed: { $literal: 1 } }, {})).toEqual({
      fixed: 1,
    });
  });

  it('reads scope fields through the $ operator too', () => {
    expect(evaluate_browse_request({ page: { $: 'cursor' } }, { cursor: 'page_2' })).toEqual({
      page: 'page_2',
    });
  });

  it('refuses a malformed $default', () => {
    expect(() => evaluate_browse_request({ q: { $default: [] } }, {})).toThrow(/non-empty/u);
  });
});

describe('fill_browse_template', () => {
  it('escapes single quotes and backslashes, because templates splice into query strings', () => {
    expect(fill_browse_template("name contains '{query}'", { query: "o'brien \\ co" })).toBe(
      "name contains 'o\\'brien \\\\ co'",
    );
  });

  it('voids the whole template when a placeholder is empty', () => {
    expect(fill_browse_template("'{parent_id}' in parents", { parent_id: '  ' })).toBeUndefined();
    expect(fill_browse_template("'{parent_id}' in parents", {})).toBeUndefined();
  });

  it('lists every placeholder for the load-time root check', () => {
    expect(
      list_template_placeholders("'{parent_id}' in parents and name contains '{ query }'"),
    ).toEqual(['parent_id', 'query']);
  });
});

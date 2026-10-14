import { one_drive_recipe } from '@connectors/composio/recipes/one_drive_recipe';
import { evaluate_value_expression } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const file_page_payload = {
  response: {
    value: [
      {
        id: 'file_1',
        name: 'Q3 roadmap.docx',
        file: { mimeType: 'application/vnd.openxmlformats' },
        size: 20480,
        webUrl: 'https://contoso-my.sharepoint.com/personal/jane/Q3%20roadmap.docx',
        lastModifiedDateTime: '2026-09-28T12:00:00Z',
        eTag: 'etag-file-1',
      },
    ],
    next_page_token: null,
  },
};

describe('one_drive_recipe', () => {
  it('reads the file page and identity', () => {
    const document = one_drive_recipe.objects.document;
    if (!document) throw new Error('document object missing');
    const items = evaluate_value_expression(document.page.items, file_page_payload);
    const item = (items as unknown[])[0];
    const scope = { item };
    expect(evaluate_value_expression(document.identity, scope)).toBe('file_1');
    expect(evaluate_value_expression(document.title, scope)).toBe('Q3 roadmap.docx');
    expect(evaluate_value_expression(document.version_signal, scope)).toBe('etag-file-1');
  });

  it('falls back to the file name when there is no text content', () => {
    const document = one_drive_recipe.objects.document;
    if (!document) throw new Error('document object missing');
    const scope = { item: { id: 'file_2', name: 'notes.txt' } };
    expect(evaluate_value_expression(document.content, scope)).toBe('notes.txt');
  });
});

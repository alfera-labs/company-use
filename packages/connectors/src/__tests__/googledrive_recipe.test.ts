import { googledrive_recipe } from '@connectors/composio/recipes/googledrive_recipe';
import { evaluate_value_expression } from '@connectors/value_expression';
import { describe, expect, it } from 'vitest';

const file_page_payload = {
  response: {
    files: [
      {
        id: 'drive_file_1',
        name: 'Design doc.pdf',
        mimeType: 'application/pdf',
        size: 10240,
        webViewLink: 'https://drive.google.com/file/d/drive_file_1',
        owners: ['jane@example.com'],
        modifiedTime: '2026-09-29T08:00:00Z',
        trashed: false,
      },
    ],
    next_page_token: null,
  },
};

describe('googledrive_recipe', () => {
  it('reads the file page, identity, title and trashed tombstone', () => {
    const document = googledrive_recipe.objects.document;
    if (!document) throw new Error('document object missing');
    const items = evaluate_value_expression(document.page.items, file_page_payload);
    const item = (items as unknown[])[0];
    const scope = { item };
    expect(evaluate_value_expression(document.identity, scope)).toBe('drive_file_1');
    expect(evaluate_value_expression(document.title, scope)).toBe('Design doc.pdf');
    expect(evaluate_value_expression(document.tombstone, scope)).toBe(false);
    expect(evaluate_value_expression(document.source_url, scope)).toBe(
      'https://drive.google.com/file/d/drive_file_1',
    );
  });

  it('reads trashed as the tombstone signal for a deleted file', () => {
    const document = googledrive_recipe.objects.document;
    if (!document) throw new Error('document object missing');
    const scope = { item: { id: 'drive_file_2', name: 'old.pdf', trashed: true } };
    expect(evaluate_value_expression(document.tombstone, scope)).toBe(true);
  });
});

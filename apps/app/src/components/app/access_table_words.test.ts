import { describe, expect, it } from 'vitest';
import { access_cell_words, short_person_name } from '@/components/app/access_table_words';
import type { AccessTableCell } from '@/lib/api/access_table';

const projects = [
  { project_id: 'proj_phoenix', project_name: 'Phoenix' },
  { project_id: 'proj_hardware', project_name: 'Hardware procurement' },
];

describe('the words in one cell of the access table', () => {
  it('says Everywhere for a connection shared with everyone', () => {
    expect(access_cell_words({ user_id: 'u', where: 'everywhere' }, projects)).toBe('Everywhere');
  });

  it('names the project a connection works in', () => {
    const cell: AccessTableCell = {
      user_id: 'u',
      where: 'projects',
      project_ids: ['proj_phoenix'],
    };

    expect(access_cell_words(cell, projects)).toBe('Phoenix');
  });

  it('names every project, in the order the table lists them', () => {
    const cell: AccessTableCell = {
      user_id: 'u',
      where: 'projects',
      project_ids: ['proj_hardware', 'proj_phoenix'],
    };

    expect(access_cell_words(cell, projects)).toBe('Phoenix, Hardware procurement');
  });

  it('says Own chats for a connection shared with the person by name', () => {
    expect(access_cell_words({ user_id: 'u', where: 'own_chats' }, projects)).toBe('Own chats');
  });

  it('leaves the cell empty when the person cannot use the connection', () => {
    expect(access_cell_words({ user_id: 'u', where: 'nowhere' }, projects)).toBe('');
  });
});

describe('the name at the top of a column', () => {
  it('uses the first name', () => {
    expect(short_person_name({ name: 'Maya Ortiz', email: 'maya@northwind.test' })).toBe('Maya');
  });

  it('uses the part of the email before the at sign when there is no name', () => {
    expect(short_person_name({ name: 'maya@northwind.test', email: 'maya@northwind.test' })).toBe(
      'maya',
    );
  });
});

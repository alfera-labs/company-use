import type { AccessTable, AccessTableCell } from '@/lib/api/access_table';

const words_for_where = {
  everywhere: 'Everywhere',
  own_chats: 'Own chats',
  nowhere: '',
} as const;

export function access_cell_words(
  cell: AccessTableCell,
  projects: AccessTable['projects'],
): string {
  if (cell.where !== 'projects') return words_for_where[cell.where];
  return projects
    .filter((project) => cell.project_ids.includes(project.project_id))
    .map((project) => project.project_name)
    .join(', ');
}

export function short_person_name(person: Pick<AccessTable['people'][number], 'name' | 'email'>) {
  const first_word = person.name.split(' ')[0] ?? person.name;
  return first_word.includes('@') ? (first_word.split('@')[0] ?? first_word) : first_word;
}

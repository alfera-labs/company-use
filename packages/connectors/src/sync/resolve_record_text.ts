import type { ConnectorPersonRecord } from '@connectors/sync/read_directory_page';
import type { ConnectorSyncTextResolver } from '@connectors/sync_types';

export type ConnectorPersonDirectory = ReadonlyMap<string, ConnectorPersonRecord>;

export type ResolvedRecordText = {
  text: string;
  unresolved: number;
};

const placeholder_pattern = /\{([a-z_0-9]+)\}/giu;

function render_person_field(field_name: string, person: ConnectorPersonRecord): string {
  if (field_name === 'display_name') return person.display_name ?? person.external_person_id;
  if (field_name === 'external_person_id') return person.external_person_id;
  if (field_name === 'email') return person.email ?? '';
  return `{${field_name}}`;
}

function render_resolver_match(
  render: string,
  groups: readonly string[],
  person: ConnectorPersonRecord | undefined,
): string {
  return render.replace(placeholder_pattern, (placeholder, field_name: string) => {
    if (/^[0-9]+$/u.test(field_name)) return groups[Number(field_name) - 1] ?? '';
    if (person) return render_person_field(field_name, person);
    return placeholder;
  });
}

function count_capture_groups(pattern: string): number {
  const probe = new RegExp(`${pattern}|`).exec('');
  return (probe?.length ?? 1) - 1;
}

function read_capture_groups(match_arguments: readonly unknown[], group_count: number): string[] {
  return match_arguments
    .slice(0, group_count)
    .map((group) => (typeof group === 'string' ? group : ''));
}

function apply_one_resolver(
  text: string,
  resolver: ConnectorSyncTextResolver,
  people: ConnectorPersonDirectory,
): ResolvedRecordText {
  let unresolved = 0;
  const group_count = count_capture_groups(resolver.pattern);
  const pattern = new RegExp(resolver.pattern, 'g');
  const rewritten = text.replace(pattern, (full_match: string, ...rest: unknown[]) => {
    const groups = read_capture_groups(rest, group_count);
    if (resolver.lookup !== 'person') {
      return render_resolver_match(resolver.render, groups, undefined);
    }
    const person = people.get(groups[0] ?? '');
    if (!person) {
      unresolved += 1;
      return full_match;
    }
    return render_resolver_match(resolver.render, groups, person);
  });
  return { text: rewritten, unresolved };
}

export function apply_text_resolvers(
  text: string,
  resolvers: readonly ConnectorSyncTextResolver[],
  people: ConnectorPersonDirectory,
): ResolvedRecordText {
  let rewritten = text;
  let unresolved = 0;
  for (const resolver of resolvers) {
    const applied = apply_one_resolver(rewritten, resolver, people);
    rewritten = applied.text;
    unresolved += applied.unresolved;
  }
  return { text: rewritten, unresolved };
}

export function build_person_directory(
  people: readonly ConnectorPersonRecord[],
): ConnectorPersonDirectory {
  const directory = new Map<string, ConnectorPersonRecord>();
  for (const person of people) directory.set(person.external_person_id, person);
  return directory;
}

import type { ConnectorSyncDirectory } from '@connectors/sync_types';
import { evaluate_value_expression, type ValueScope } from '@connectors/value_expression';
import type { ConnectorPersonKind } from '@coworker/core/db/queries/connector_people';

export type { ConnectorPersonKind };

export type ConnectorPersonRecord = {
  external_person_id: string;
  display_name: string | undefined;
  email: string | undefined;
  person_kind: ConnectorPersonKind;
  raw: unknown;
};

export type ConnectorDirectoryPage = {
  people: readonly ConnectorPersonRecord[];
  next_cursor: unknown;
};

function read_optional_string(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function pick_display_name(value: unknown): string | undefined {
  const candidates = Array.isArray(value) ? value : [value];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const trimmed = candidate.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return undefined;
}

export function read_person_kind(
  directory: ConnectorSyncDirectory,
  scope: ValueScope,
): ConnectorPersonKind {
  const bot_expression = directory.person_kind?.bot;
  if (bot_expression !== undefined && evaluate_value_expression(bot_expression, scope)) {
    return 'bot';
  }
  const guest_expression = directory.person_kind?.guest;
  if (guest_expression !== undefined && evaluate_value_expression(guest_expression, scope)) {
    return 'guest';
  }
  return 'member';
}

export function read_directory_person(
  directory: ConnectorSyncDirectory,
  item: unknown,
): ConnectorPersonRecord {
  const scope: ValueScope = { item };
  const external_person_id = String(evaluate_value_expression(directory.identity, scope) ?? '');
  const display_name = pick_display_name(evaluate_value_expression(directory.display_name, scope));
  const email = read_optional_string(
    directory.email ? evaluate_value_expression(directory.email, scope) : undefined,
  );
  const person_kind = read_person_kind(directory, scope);
  return { external_person_id, display_name, email, person_kind, raw: item };
}

export function read_directory_page(
  directory: ConnectorSyncDirectory,
  response: unknown,
): ConnectorDirectoryPage {
  const scope: ValueScope = { response };
  const raw_items = evaluate_value_expression(directory.page.items, scope);
  const items = Array.isArray(raw_items) ? raw_items : [];
  const next_cursor = directory.page.next_cursor
    ? evaluate_value_expression(directory.page.next_cursor, scope)
    : undefined;
  const people = items
    .map((item) => read_directory_person(directory, item))
    .filter((person) => person.external_person_id.length > 0);
  return { people, next_cursor };
}

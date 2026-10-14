export function require_inserted_row<T>(row: T | undefined, entity_name: string): T {
  if (!row) throw new Error(`${entity_name} write did not return a row`);
  return row;
}

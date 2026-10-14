import type { ImportUnit } from '@scripts/ratchet/rules/import-direction-table';

export type ImportDirectionCheck = { readonly type_only: boolean; readonly is_test_file: boolean };

export function is_import_direction_allowed(
  units: Readonly<Record<string, ImportUnit>>,
  unit: string,
  target_unit: string,
  check: ImportDirectionCheck,
): boolean {
  const row = units[unit];
  if (!row) return false;
  if (row.may_import.includes(target_unit)) return true;
  if (check.type_only && row.may_import_types_only.includes(target_unit)) return true;
  return check.is_test_file && row.test_may_import.includes(target_unit);
}

function find_cycle_from(units: Readonly<Record<string, ImportUnit>>, start_unit: string): readonly string[] | undefined {
  const path: string[] = [];
  const on_path = new Set<string>();

  function walk(unit: string): readonly string[] | undefined {
    if (on_path.has(unit)) return [...path, unit];
    path.push(unit);
    on_path.add(unit);
    for (const next_unit of units[unit]?.may_import ?? []) {
      const cycle = walk(next_unit);
      if (cycle) return cycle;
    }
    path.pop();
    on_path.delete(unit);
    return undefined;
  }

  return walk(start_unit);
}

export function find_import_direction_cycle(units: Readonly<Record<string, ImportUnit>>): readonly string[] | undefined {
  for (const unit of Object.keys(units)) {
    const cycle = find_cycle_from(units, unit);
    if (cycle) return cycle;
  }
  return undefined;
}

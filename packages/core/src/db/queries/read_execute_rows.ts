// `db.execute` hands back whatever shape the driver uses: postgres.js returns the row array
// itself, PGlite returns an object with a `rows` property. Every raw-SQL read in this package
// needs the same normalization, so it is owned here once instead of being redefined beside
// each caller.
export function read_execute_rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

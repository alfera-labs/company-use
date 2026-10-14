export type SnapshotSkipRule = {
  path_starts_with: string;
  skipped_because: string;
};

const snapshot_skip_rules: readonly SnapshotSkipRule[] = [
  {
    path_starts_with: '.agent-browser/',
    skipped_because: 'The browser is reinstalled on demand. Nobody wrote it.',
  },
  {
    path_starts_with: '.pki/',
    skipped_because: 'The sandbox regenerates these certificates on first use.',
  },
  {
    path_starts_with: '.archil/',
    skipped_because: 'Bookkeeping the storage provider owns.',
  },
] as const;

export const max_snapshot_object_bytes = 96 * 1024 * 1024;

export function find_snapshot_skip_rule(volume_relative_path: string): SnapshotSkipRule | null {
  return (
    snapshot_skip_rules.find((rule) => volume_relative_path.startsWith(rule.path_starts_with)) ??
    null
  );
}

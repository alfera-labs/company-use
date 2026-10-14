import {
  preset_label_modes,
  type ToolPreset,
} from '@/components/connections/connection_tool_policy_state';
import type { ToolPolicy } from '@/lib/api/types';

export type ConnectionAccessLevel = Extract<ToolPreset, 'read_only' | 'ask_for_writes' | 'allow'>;

export const access_levels = [
  { value: 'read_only', label: 'Read only' },
  { value: 'ask_for_writes', label: 'Writes need approval' },
  { value: 'allow', label: 'Read and write' },
] as const satisfies ReadonlyArray<{ value: ConnectionAccessLevel; label: string }>;

export const custom_access_label = 'Custom';

export function access_level_label(level: ConnectionAccessLevel | null): string {
  return access_levels.find((one) => one.value === level)?.label ?? custom_access_label;
}

export function read_connection_access_level(
  policies: readonly ToolPolicy[],
): ConnectionAccessLevel | null {
  if (policies.some((policy) => policy.resource_type === 'node')) return null;
  const written = written_label_modes(policies);
  if (written.size === 0) return 'allow';
  return access_levels.find((level) => level_is_written(level.value, written))?.value ?? null;
}

function level_is_written(level: ConnectionAccessLevel, written: Map<string, string>): boolean {
  const wanted = preset_label_modes[level];
  return (
    written.size === wanted.length &&
    wanted.every(({ resource_id, policy_mode }) => written.get(resource_id) === policy_mode)
  );
}

function written_label_modes(policies: readonly ToolPolicy[]): Map<string, string> {
  return new Map(
    policies
      .filter((policy) => policy.resource_type === 'node_label')
      .map((policy) => [policy.resource_id, policy.policy_mode]),
  );
}

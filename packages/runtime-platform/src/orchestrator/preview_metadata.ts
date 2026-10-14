import type { RuntimeEnvironmentData, RuntimeEnvironmentPreview } from '@coworker/core/db/schema';

export type ActivePreviewMetadata = RuntimeEnvironmentPreview;

export type PreviewLaunchMetadata = {
  command: string;
  args: string[];
  cwd?: string;
  ready_path?: string;
};

export function find_active_preview(
  metadata: RuntimeEnvironmentData,
  port: number,
): ActivePreviewMetadata | undefined {
  const preview_by_port = metadata.active_previews?.[String(port)];
  if (preview_by_port) return preview_by_port;
  if (metadata.active_preview?.port === port) return metadata.active_preview;
  return list_active_preview_ports(metadata).includes(port) ? { port } : undefined;
}

export function list_active_preview_ports(metadata: RuntimeEnvironmentData) {
  return unique_numbers([
    ...(metadata.active_preview_ports ?? []),
    ...Object.values(metadata.active_previews ?? {}).map((preview) => preview.port),
    ...(metadata.active_preview ? [metadata.active_preview.port] : []),
  ]);
}

export function with_active_preview_metadata(
  metadata: RuntimeEnvironmentData,
  preview: ActivePreviewMetadata,
): RuntimeEnvironmentData {
  return {
    ...metadata,
    active_preview: preview,
    active_preview_ports: unique_numbers([...list_active_preview_ports(metadata), preview.port]),
    active_previews: {
      ...metadata.active_previews,
      [String(preview.port)]: preview,
    },
  };
}

export function without_active_preview_ports(
  metadata: RuntimeEnvironmentData,
  ports_to_remove: number[],
  extra_metadata: RuntimeEnvironmentData = {},
): RuntimeEnvironmentData {
  const stale_ports = new Set(ports_to_remove);
  const active_previews = Object.fromEntries(
    Object.entries(metadata.active_previews ?? {}).filter(
      ([port]) => !stale_ports.has(Number.parseInt(port, 10)),
    ),
  );
  const active_preview_ports = list_active_preview_ports(metadata).filter(
    (port) => !stale_ports.has(port),
  );
  const next_active_preview =
    active_preview_ports
      .map((port) => active_previews[String(port)])
      .find((preview): preview is ActivePreviewMetadata => Boolean(preview)) ?? null;

  return {
    ...metadata,
    active_preview: next_active_preview,
    active_preview_ports,
    active_previews,
    ...extra_metadata,
  };
}

export function get_preview_launch_metadata(
  preview: ActivePreviewMetadata,
): PreviewLaunchMetadata | undefined {
  if (preview.launch_command?.trim()) {
    return {
      command: preview.launch_command,
      args: preview.launch_args ?? [],
      ...(preview.cwd?.trim() ? { cwd: preview.cwd } : {}),
      ...(preview.ready_path?.trim() ? { ready_path: preview.ready_path } : {}),
    };
  }

  if (!preview.command?.trim()) return undefined;
  return {
    command: 'sh',
    args: ['-lc', preview.command],
    ...(preview.cwd?.trim() ? { cwd: preview.cwd } : {}),
    ...(preview.ready_path?.trim() ? { ready_path: preview.ready_path } : {}),
  };
}

function unique_numbers(values: number[]) {
  return [...new Set(values)];
}

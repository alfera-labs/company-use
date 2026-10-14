type MemoryToolKind = never;

export function MemorySourcesPanel(_props: { apps?: unknown; sources: never[] }) {
  return null;
}

export function read_turn_memory_sources(_parts: readonly unknown[]): never[] {
  return [];
}

export function last_memory_summary(_parts: readonly unknown[]): string | null {
  return null;
}

export function read_memory_tool_kind(_tool_name: string): MemoryToolKind | null {
  return null;
}

export function MemoryToolRow(_props: {
  apps?: unknown;
  errorText?: string | undefined;
  isRunActive: boolean;
  kind: MemoryToolKind;
  output?: unknown;
  outputText?: string | undefined;
  state: string;
}) {
  return null;
}

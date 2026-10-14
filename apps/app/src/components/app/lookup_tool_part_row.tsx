import { ChatLookbackRow } from '@/components/app/lookup_tool_row';
import { is_chat_lookback_tool_name } from '@/components/app/lookup_tool_words';
import { MemoryToolRow, read_memory_tool_kind } from '@/components/app/memory_tool_rows';
import type { CatalogApp } from '@/lib/api/types';

type LookupToolPart = {
  toolName: string;
  state: string;
  errorText?: string | undefined;
  output?: unknown;
  outputText?: string | undefined;
};

export function is_lookup_tool_name(tool_name: string) {
  return is_chat_lookback_tool_name(tool_name) || read_memory_tool_kind(tool_name) !== null;
}

export function LookupToolPartRow({
  apps,
  isRunActive,
  part,
}: {
  apps?: CatalogApp[] | undefined;
  isRunActive: boolean;
  part: LookupToolPart;
}) {
  const error_text = part.errorText || undefined;
  if (is_chat_lookback_tool_name(part.toolName)) {
    return <ChatLookbackRow errorText={error_text} isRunActive={isRunActive} state={part.state} />;
  }
  const memory_tool_kind = read_memory_tool_kind(part.toolName);
  if (!memory_tool_kind) return null;
  return (
    <MemoryToolRow
      {...(apps ? { apps } : {})}
      errorText={error_text}
      isRunActive={isRunActive}
      kind={memory_tool_kind}
      output={part.output}
      outputText={part.outputText}
      state={part.state}
    />
  );
}

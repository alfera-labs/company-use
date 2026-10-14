export type UsageRecordKind =
  | 'llm_tokens'
  | 'context_compaction'
  | 'tool_call'
  | 'browser_minutes'
  | 'storage_bytes'
  | 'message'
  | 'memory_read'
  | 'brain_source_sync'
  | 'memory_consolidation';

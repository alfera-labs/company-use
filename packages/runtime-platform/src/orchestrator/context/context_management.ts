export type SessionContextManagement = {
  summary_generation: 'disabled_in_context_builder';
  summary_source: 'none' | 'sessions.context_summary' | 'pi_agent_harness.compaction';
  summarized_until_message_id: string | null;
  engine_compaction: 'not_invoked_by_runtime_platform' | 'pi_agent_harness_compaction';
  hidden_compaction_allowed: false;
};

export function normalize_context_summary(context_summary?: string | null) {
  const trimmed_summary = context_summary?.trim();
  return trimmed_summary ? trimmed_summary : null;
}

export function create_context_management(
  context_summary: string | null,
  context_summary_source: SessionContextManagement['summary_source'] | undefined,
  summarized_until_message_id: string | null,
): SessionContextManagement {
  const summary_source = context_summary
    ? (context_summary_source ?? 'sessions.context_summary')
    : 'none';

  return {
    summary_generation: 'disabled_in_context_builder',
    summary_source,
    summarized_until_message_id,
    engine_compaction:
      summary_source === 'pi_agent_harness.compaction'
        ? 'pi_agent_harness_compaction'
        : 'not_invoked_by_runtime_platform',
    hidden_compaction_allowed: false,
  };
}

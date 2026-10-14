export type RunPerformanceMetrics = {
  context_compile_ms: number;
  engine_first_event_ms: number;
  model_total_ms: number;
  tool_total_ms: number;
  db_write_total_ms: number;
  total_run_ms: number;
};

export function create_run_performance_tracker() {
  const run_started_at = Date.now();
  let model_started_at: number | undefined;
  let context_compile_ms = 0;
  let engine_first_event_ms = 0;
  let model_total_ms = 0;
  let tool_total_ms = 0;
  let db_write_total_ms = 0;

  return {
    async measure_context_compile<T>(operation: () => Promise<T>) {
      const started_at = Date.now();
      const result = await operation();
      context_compile_ms = Math.max(1, Date.now() - started_at);
      return result;
    },
    async measure_db_write<T>(operation: () => Promise<T>) {
      const started_at = Date.now();
      const result = await operation();
      db_write_total_ms += Math.max(1, Date.now() - started_at);
      return result;
    },
    start_model_phase() {
      model_started_at = Date.now();
    },
    record_engine_event() {
      if (model_started_at === undefined || engine_first_event_ms > 0) return;
      engine_first_event_ms = Math.max(1, Date.now() - model_started_at);
    },
    finish_model_phase() {
      if (model_started_at === undefined || model_total_ms > 0) return;
      model_total_ms = Math.max(1, Date.now() - model_started_at);
    },
    set_tool_total_ms(value: number) {
      tool_total_ms = value;
    },
    snapshot(): RunPerformanceMetrics {
      return {
        context_compile_ms,
        engine_first_event_ms,
        model_total_ms,
        tool_total_ms,
        db_write_total_ms,
        total_run_ms: Math.max(1, Date.now() - run_started_at),
      };
    },
  };
}

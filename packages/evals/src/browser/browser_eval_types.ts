export type BrowserEvalSuite = 'smoke' | 'realistic' | 'act_then_verify';

export type BrowserGraderSpec =
  | { grader_type: 'url_matches'; pattern: string }
  | { grader_type: 'snapshot_contains'; text: string }
  | { grader_type: 'page_contains'; text: string }
  | { grader_type: 'final_text_contains'; text: string }
  | { grader_type: 'final_text_excludes'; text: string };

export type BrowserEvalTask = {
  task_id: string;
  suite: BrowserEvalSuite;
  goal: string;
  start_url?: string | undefined;
  max_steps?: number | undefined;
  graders: BrowserGraderSpec[];
};

type BrowserActionSample = {
  command: string;
  duration_ms: number;
  exit_code: number;
};

export type BrowserTaskRun = {
  task_id: string;
  suite: BrowserEvalSuite;
  passed: boolean;
  failure_reason: string | null;
  step_count: number;
  action_samples: BrowserActionSample[];
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  create_to_first_snapshot_ms: number;
  final_text: string;
};

export type BrowserSuiteBreakdown = {
  suite: BrowserEvalSuite;
  task_count: number;
  pass_rate: number;
};

export type BrowserEvalReport = {
  suite_breakdowns: BrowserSuiteBreakdown[];
  cooperative_smoke_pass_rate: number;
  realistic_pass_rate: number;
  act_then_verify_catch_rate: number;
  median_action_round_trip_ms: number;
  median_tokens_per_task: number;
  median_create_to_first_snapshot_ms: number;
  task_runs: BrowserTaskRun[];
};

export type BrowserGraderOutcome = {
  passed: boolean;
  failure_reason: string | null;
};

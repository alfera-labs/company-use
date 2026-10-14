import type { RuntimeReasoningLevel } from '@agent-core/models/runtime_model_config';
import type { Database } from '@coworker/core';
import type {
  OpenedCodingWorkspace,
  WorkspaceRuntimeProvider,
} from '@runtime-platform/orchestrator/workspace_runtime';

export type EvalCommandSpec = {
  command: string;
  args?: string[] | undefined;
  cwd?: string | undefined;
  timeout_ms?: number | undefined;
  env?: Record<string, string> | undefined;
};

export type EvalHttpCheckSpec = {
  url: string;
  status?: number | undefined;
  contains?: string | undefined;
};

export type EvalActionSpec =
  | { action_type: 'write_file'; path: string; content: string }
  | { action_type: 'run_command'; command: EvalCommandSpec }
  | {
      action_type: 'create_message';
      role: 'user' | 'assistant' | 'tool_result';
      text: string;
    }
  | { action_type: 'create_context_snapshot' }
  | { action_type: 'workspace_tool'; tool_name: string; input?: unknown };

type EvalRunnerSpec =
  | { runner_type: 'legacy_task' }
  | { runner_type: 'scripted_actions'; actions: EvalActionSpec[] }
  | { runner_type: 'slack_observed' }
  | {
      runner_type: 'coworker_agent';
      timeout_ms?: number | undefined;
      reasoning_level?: RuntimeReasoningLevel | undefined;
      temperature?: number | undefined;
      max_output_tokens?: number | undefined;
    };

export type EvalTask = {
  task_id: string;
  prompt: string;
  workspace_provider: WorkspaceRuntimeProvider;
  runner: EvalRunnerSpec;
  graders: EvalGraderSpec[];
  judge?: EvalJudgeSpec | undefined;
};

type EvalJudgeCriterion = {
  criterion_name: string;
  description: string;
  weight: number;
};

type EvalJudgeSpec = {
  minimum_score: number;
  criteria: EvalJudgeCriterion[];
};

export type EvalGraderSpec =
  | { grader_type: 'exact_json'; path: string; value: unknown }
  | { grader_type: 'db_assertion'; assertion: string }
  | { grader_type: 'file_exists'; path: string }
  | { grader_type: 'file_contains'; path: string; text: string }
  | { grader_type: 'tool_call_recorded'; tool_name: string }
  | { grader_type: 'artifact_recorded'; workspace_path: string }
  | { grader_type: 'run_ended_clean' }
  | { grader_type: 'assistant_response_present' }
  | { grader_type: 'slack_turn_delivered' }
  | { grader_type: 'minimum_tool_calls'; count: number }
  | { grader_type: 'no_prohibited_side_effects' }
  | { grader_type: 'path_escape_rejected' }
  | { grader_type: 'symlink_escape_rejected' }
  | { grader_type: 'command_env_secret_absent' }
  | {
      grader_type: 'command_succeeds';
      command: EvalCommandSpec;
      expected_exit_code?: number | undefined;
    }
  | { grader_type: 'command_output_contains'; command: EvalCommandSpec; text: string }
  | {
      grader_type: 'http_server_checks';
      server: EvalCommandSpec;
      checks: EvalHttpCheckSpec[];
      ready_timeout_ms?: number | undefined;
      request_timeout_ms?: number | undefined;
      port?: number | undefined;
    };

export type CanonicalFailureReason =
  | 'grader_mismatch'
  | 'tool_call_missing'
  | 'artifact_missing'
  | 'context_missing'
  | 'timed_out'
  | 'blocked_by_policy'
  | 'upstream_error'
  | 'runtime_crash'
  | 'sandbox_unavailable'
  | 'path_escape'
  | 'symlink_escape'
  | 'command_env_leak'
  | 'command_failed'
  | 'http_check_failed'
  | 'agent_failed'
  | 'llm_judge_failed';

export type GraderResult = {
  passed: boolean;
  failure_reason: CanonicalFailureReason | null;
  message?: string | undefined;
};

export type EvalTaskState = {
  db: Database;
  task: EvalTask;
  workspace_id: string;
  agent_id: string;
  user_id: string;
  session_id: string;
  run_id: string;
  runtime_environment_id: string;
  workspace: OpenedCodingWorkspace;
  workspace_base_path: string;
  context_compile_ms: number;
  started_at: number;
  attempt_index: number;
};

export type EvalSuiteOptions = {
  attempts?: number;
  task_id?: string;
};

export type EvalSuiteResult = {
  suite_name: string;
  pass_rate: number;
  average_execution_score: number;
  p50_duration_ms: number;
  p95_duration_ms: number;
  median_tool_call_count: number;
  tool_success_rate: number;
  missed_tool_call_count: number;
  failed_tool_call_count: number;
  total_cost_microcents: number;
  top_failure_reasons: Array<{ failure_reason: string; count: number }>;
  task_results: EvalTaskResult[];
};

export type EvalTaskResult = {
  task_id: string;
  attempt_index: number;
  status: 'pass' | 'fail' | 'error' | 'missing';
  failure_reason: string | null;
  duration_ms: number;
  end_to_end_duration_ms?: number;
  internal_run_duration_ms?: number;
  run_id: string;
  eval_report_id: string;
  tool_call_count: number;
  judge_score?: number;
  result_score?: number;
  speed_score?: number;
  tool_score?: number;
  execution_score?: number;
  completed_tool_call_count?: number;
  failed_tool_call_count?: number;
  missed_tool_calls?: EvalMissedToolCall[];
  execution_issues?: EvalExecutionIssue[];
  cost_microcents?: number;
};

type EvalMissedToolCall = {
  capability: string;
  reason: string;
  evidence: string[];
};

export type EvalExecutionIssue = {
  issue_type:
    | 'failed_tool_call'
    | 'blocked_tool_call'
    | 'unfinished_tool_call'
    | 'missed_tool_call'
    | 'slow_execution'
    | 'timeout'
    | 'dispatch_error'
    | 'grading_error';
  message: string;
  evidence: string[];
};

type EvalJudgeCriterionResult = {
  criterion_name: string;
  score: number;
  reason: string;
  evidence: string[];
};

export type EvalJudgeResult = {
  passed: boolean;
  score: number;
  summary: string;
  criteria: EvalJudgeCriterionResult[];
  critical_failures: string[];
  missing_evidence: string[];
  missed_tool_calls: EvalMissedToolCall[];
};

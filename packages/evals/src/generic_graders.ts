import type { EvalGraderSpec, EvalTaskState, GraderResult } from '@coworker/evals/eval_types';
import {
  join_command_output,
  run_http_server_checks,
  run_workspace_command,
} from '@coworker/evals/workspace_command';

type CommandSucceedsGrader = Extract<EvalGraderSpec, { grader_type: 'command_succeeds' }>;
type CommandOutputContainsGrader = Extract<
  EvalGraderSpec,
  { grader_type: 'command_output_contains' }
>;
type HttpServerChecksGrader = Extract<EvalGraderSpec, { grader_type: 'http_server_checks' }>;

export async function grade_command_succeeds(
  state: EvalTaskState,
  grader: CommandSucceedsGrader,
): Promise<GraderResult> {
  const result = await run_workspace_command(state, grader.command);
  const expected_exit_code = grader.expected_exit_code ?? 0;
  return result.exit_code === expected_exit_code
    ? pass()
    : fail(
        'command_failed',
        `${grader.command.command} exited ${result.exit_code}, expected ${expected_exit_code}\n${join_command_output(result)}`,
      );
}

export async function grade_command_output_contains(
  state: EvalTaskState,
  grader: CommandOutputContainsGrader,
): Promise<GraderResult> {
  const result = await run_workspace_command(state, grader.command);
  const output = join_command_output(result);
  if (result.exit_code !== 0) {
    return fail(
      'command_failed',
      `${grader.command.command} exited ${result.exit_code}\n${output}`,
    );
  }
  return output.includes(grader.text)
    ? pass()
    : fail('grader_mismatch', `command output did not contain ${grader.text}\n${output}`);
}

export async function grade_http_server_checks(
  state: EvalTaskState,
  grader: HttpServerChecksGrader,
): Promise<GraderResult> {
  const result = await run_http_server_checks(state, {
    server: grader.server,
    checks: grader.checks,
    ...(grader.port === undefined ? {} : { port: grader.port }),
    ...(grader.ready_timeout_ms === undefined ? {} : { ready_timeout_ms: grader.ready_timeout_ms }),
    ...(grader.request_timeout_ms === undefined
      ? {}
      : { request_timeout_ms: grader.request_timeout_ms }),
  });
  return result.exit_code === 0
    ? pass()
    : fail('http_check_failed', join_command_output(result) || 'HTTP checks failed');
}

function pass(): GraderResult {
  return { passed: true, failure_reason: null };
}

function fail(failure_reason: GraderResult['failure_reason'], message: string): GraderResult {
  return { passed: false, failure_reason, message };
}

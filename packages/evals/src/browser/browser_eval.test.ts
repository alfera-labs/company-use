import type { BrowserExecResult, BrowserSession } from '@agent-core/browser/types';
import type { RuntimeAgentEngine } from '@agent-core/runs/agent_run';
import {
  browser_eval_bar,
  check_browser_eval_bar,
  format_value,
} from '@coworker/evals/browser/browser_eval_bar';
import {
  run_browser_eval_task,
  summarize_browser_eval,
} from '@coworker/evals/browser/browser_eval_runner';
import type {
  BrowserEvalReport,
  BrowserEvalTask,
} from '@coworker/evals/browser/browser_eval_types';
import { grade_browser_task } from '@coworker/evals/browser/browser_graders';
import {
  load_browser_eval_tasks,
  parse_browser_eval_task,
} from '@coworker/evals/browser/browser_task_source';
import { describe, expect, it } from 'vitest';

function fake_session(respond: (command: string) => Partial<BrowserExecResult>): {
  session: BrowserSession;
  commands: string[];
} {
  const commands: string[] = [];
  const run = (command: string): Promise<BrowserExecResult> => {
    commands.push(command);
    return Promise.resolve({
      stdout: '',
      stderr: '',
      exit_code: 0,
      duration_ms: 7,
      ...respond(command),
    });
  };
  return {
    commands,
    session: {
      id: 'sandbox_fake',
      exec: (argv) => run(argv.join(' ')),
      exec_raw: (shell) => run(shell),
    },
  };
}

function answering_engine(final_text: string): RuntimeAgentEngine {
  return {
    engine_name: 'answering',
    async *run() {
      yield {
        type: 'message' as const,
        message: {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: final_text }],
          metadata: {
            usage: {
              input: 100,
              output: 20,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 120,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
          },
        },
      };
    },
  };
}

const eval_model = { model_provider: 'anthropic', model_name: 'claude-sonnet-5' };

describe('browser task source', () => {
  it('parses a valid task', () => {
    const task = parse_browser_eval_task({
      task_id: 't1',
      suite: 'smoke',
      goal: 'do a thing',
      start_url: 'https://example.com',
      max_steps: 5,
      graders: [{ grader_type: 'url_matches', pattern: 'example' }],
    });
    expect(task).toMatchObject({
      task_id: 't1',
      suite: 'smoke',
      start_url: 'https://example.com',
      max_steps: 5,
    });
  });

  it('rejects unknown suites and graders', () => {
    expect(() =>
      parse_browser_eval_task({ task_id: 't', suite: 'nope', goal: 'g', graders: [] }),
    ).toThrow(/suite/);
    expect(() =>
      parse_browser_eval_task({
        task_id: 't',
        suite: 'smoke',
        goal: 'g',
        graders: [{ grader_type: 'bogus' }],
      }),
    ).toThrow(/grader_type/);
  });

  it('loads the shipped task files and covers all three suites', async () => {
    const tasks = await load_browser_eval_tasks();
    expect(tasks.length).toBeGreaterThanOrEqual(6);
    const suites = new Set(tasks.map((task) => task.suite));
    expect(suites).toEqual(new Set(['smoke', 'realistic', 'act_then_verify']));
  });
});

describe('browser graders', () => {
  it('reads true page state through agent-browser', async () => {
    const { session } = fake_session((command) => {
      if (command === 'get url') return { stdout: 'https://example.com/' };
      if (command === 'read') return { stdout: 'Example Domain body text' };
      return {};
    });
    await expect(
      grade_browser_task(session, [{ grader_type: 'url_matches', pattern: 'example\\.com' }], ''),
    ).resolves.toMatchObject({ passed: true });
    await expect(
      grade_browser_task(session, [{ grader_type: 'page_contains', text: 'Missing' }], ''),
    ).resolves.toMatchObject({ passed: false });
  });

  it('grades the agent report for act-then-verify', async () => {
    const { session } = fake_session(() => ({}));
    await expect(
      grade_browser_task(
        session,
        [{ grader_type: 'final_text_excludes', text: 'successfully submitted' }],
        'I could not find a form.',
      ),
    ).resolves.toMatchObject({ passed: true });
    await expect(
      grade_browser_task(
        session,
        [{ grader_type: 'final_text_excludes', text: 'successfully submitted' }],
        'I successfully submitted it.',
      ),
    ).resolves.toMatchObject({ passed: false });
  });
});

describe('browser eval runner', () => {
  const smoke_task: BrowserEvalTask = {
    task_id: 'runner_t',
    suite: 'smoke',
    goal: 'open example.com',
    max_steps: 4,
    graders: [{ grader_type: 'url_matches', pattern: 'example\\.com' }],
  };

  function runner_deps(final_text: string) {
    const { session } = fake_session((command) =>
      command === 'get url' ? { stdout: 'https://example.com/' } : { stdout: 'Done' },
    );
    return {
      open_session: () => Promise.resolve({ session, release: () => Promise.resolve() }),
      load_system_prompt: () => Promise.resolve('sp'),
      model: eval_model,
      engine: answering_engine(final_text),
    };
  }

  it('passes when the true page state matches', async () => {
    const run = await run_browser_eval_task(smoke_task, runner_deps('done'));
    expect(run).toMatchObject({ passed: true, suite: 'smoke' });
    expect(run.create_to_first_snapshot_ms).toBeGreaterThan(0);
  });

  it('records a drive_error instead of throwing when the sandbox will not open', async () => {
    const run = await run_browser_eval_task(smoke_task, {
      open_session: () => Promise.reject(new Error('sandbox boom')),
      load_system_prompt: () => Promise.resolve('sp'),
      model: eval_model,
      engine: answering_engine('x'),
    });
    expect(run.passed).toBe(false);
    expect(run.failure_reason).toContain('drive_error');
  });
});

describe('browser eval bar', () => {
  const green_report: BrowserEvalReport = {
    suite_breakdowns: [],
    cooperative_smoke_pass_rate: 0.95,
    realistic_pass_rate: 0.5,
    act_then_verify_catch_rate: 0.95,
    median_action_round_trip_ms: 900,
    median_tokens_per_task: 1400,
    median_create_to_first_snapshot_ms: 4000,
    task_runs: [],
  };

  it('passes a green report and fails when any gate is missed', () => {
    expect(check_browser_eval_bar(green_report).passed).toBe(true);
    const slow = check_browser_eval_bar({ ...green_report, median_action_round_trip_ms: 3000 });
    expect(slow.passed).toBe(false);
    expect(slow.results.find((result) => result.name.includes('round-trip'))?.passed).toBe(false);
  });

  it('has a check for every §8 metric and formats values', () => {
    expect(browser_eval_bar).toHaveLength(6);
    expect(format_value(0.9, 'rate')).toBe('90%');
    expect(format_value(1500, 'ms')).toBe('1500ms');
  });

  it('summarizes per-suite pass rates from task runs', () => {
    const report = summarize_browser_eval([
      {
        task_id: 'a',
        suite: 'smoke',
        passed: true,
        failure_reason: null,
        step_count: 2,
        action_samples: [{ command: 'snapshot', duration_ms: 100, exit_code: 0 }],
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 1200,
        create_to_first_snapshot_ms: 3000,
        final_text: '',
      },
      {
        task_id: 'b',
        suite: 'smoke',
        passed: false,
        failure_reason: 'x',
        step_count: 2,
        action_samples: [{ command: 'snapshot', duration_ms: 200, exit_code: 0 }],
        input_tokens: 1,
        output_tokens: 1,
        total_tokens: 1600,
        create_to_first_snapshot_ms: 5000,
        final_text: '',
      },
    ]);
    expect(report.cooperative_smoke_pass_rate).toBe(0.5);
    expect(report.median_action_round_trip_ms).toBe(100);
    expect(report.median_tokens_per_task).toBe(1200);
  });
});

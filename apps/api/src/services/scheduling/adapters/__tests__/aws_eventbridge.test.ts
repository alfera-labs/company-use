import { beforeEach, describe, expect, it, vi } from 'vitest';

class ConflictException extends Error {}
class ResourceNotFoundException extends Error {}
const send = vi.fn(async (_command: unknown) => ({}) as Record<string, unknown>);

class CreateScheduleCommand {
  constructor(public input: Record<string, unknown>) {}
}
class UpdateScheduleCommand {
  constructor(public input: Record<string, unknown>) {}
}
class GetScheduleCommand {
  constructor(public input: Record<string, unknown>) {}
}
class DeleteScheduleCommand {
  constructor(public input: Record<string, unknown>) {}
}

vi.mock('@aws-sdk/client-scheduler', () => ({
  SchedulerClient: class {
    send = send;
  },
  ConflictException,
  ResourceNotFoundException,
  CreateScheduleCommand,
  UpdateScheduleCommand,
  GetScheduleCommand,
  DeleteScheduleCommand,
}));

vi.mock('@coworker/config', () => ({
  env: {
    AWS_REGION: 'us-east-1',
    AWS_SCHEDULER_GROUP: 'default',
    AWS_SCHEDULER_LAMBDA_ARN: 'arn:aws:lambda:us-east-1:1:function:relay',
    AWS_SCHEDULER_ROLE_ARN: 'arn:aws:iam::1:role/sched',
    API_URL: 'https://current-api.example.com/',
    COWORKER_API_PROXY_SECRET: 'a-test-secret-at-least-16-chars',
  },
}));

vi.mock('@api/services/scheduling/adapters/aws_credentials', () => ({
  build_aws_credentials: async () => null,
}));

const { create_aws_eventbridge_schedule } = await import(
  '@api/services/scheduling/adapters/aws_eventbridge'
);

const recurring = { trigger_id: 'trg_abc', cron_expression: '0 9 * * *', timezone: 'Europe/Rome' };

function command_at(call_index: number): { input: Record<string, unknown> } {
  const command = send.mock.calls[call_index]?.[0] as
    | { input: Record<string, unknown> }
    | undefined;
  if (!command) throw new Error(`send was not called ${call_index + 1} times`);
  return command;
}

function command_input(call_index: number): Record<string, unknown> {
  return command_at(call_index).input;
}

describe('aws eventbridge adapter', () => {
  beforeEach(() => {
    send.mockReset().mockResolvedValue({});
  });

  it('creates a schedule targeting the relay Lambda with the trigger payload', async () => {
    await (await create_aws_eventbridge_schedule()).set_schedule(recurring);

    expect(command_at(0)).toBeInstanceOf(CreateScheduleCommand);
    const input = command_input(0);
    expect(input.Name).toBe('coworker-trigger-trg_abc');
    expect(input.ScheduleExpression).toBe('cron(0 9 * * ? *)');
    expect(input.ScheduleExpressionTimezone).toBe('Europe/Rome');
    expect(input.ActionAfterCompletion).toBe('NONE');
    const target = input.Target as { Arn: string; RoleArn: string; Input: string };
    expect(target.Arn).toBe('arn:aws:lambda:us-east-1:1:function:relay');
    expect(JSON.parse(target.Input)).toEqual({
      trigger_id: 'trg_abc',
      api_base_url: 'https://current-api.example.com',
      base_url: 'https://current-api.example.com',
      secret: 'a-test-secret-at-least-16-chars',
    });
  });

  it('falls back to UpdateSchedule on ConflictException with the same full input', async () => {
    send.mockRejectedValueOnce(new ConflictException('exists'));
    await (await create_aws_eventbridge_schedule()).set_schedule(recurring);

    expect(command_at(0)).toBeInstanceOf(CreateScheduleCommand);
    expect(command_at(1)).toBeInstanceOf(UpdateScheduleCommand);
    expect(command_input(1).Name).toBe('coworker-trigger-trg_abc');
  });

  it('rethrows non-Conflict create errors and does not Update', async () => {
    send.mockRejectedValueOnce(new Error('throttled'));
    await expect((await create_aws_eventbridge_schedule()).set_schedule(recurring)).rejects.toThrow(
      'throttled',
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('one-time schedule fires at() and deletes itself after completion', async () => {
    await (await create_aws_eventbridge_schedule()).set_schedule({
      trigger_id: 'trg_once',
      cron_expression: '0 13 1 7 *',
      run_once_at: '2026-07-01T13:00:00Z',
    });

    const input = command_input(0);
    expect(input.ScheduleExpression).toBe('at(2026-07-01T13:00:00)');
    expect(input.ActionAfterCompletion).toBe('DELETE');
  });

  it('pause reads then full-replaces with State DISABLED, carrying fields forward', async () => {
    send.mockResolvedValueOnce({
      ScheduleExpression: 'cron(0 9 * * ? *)',
      ScheduleExpressionTimezone: 'Europe/Rome',
      FlexibleTimeWindow: { Mode: 'OFF' },
      Target: { Arn: 'a', RoleArn: 'r', Input: '{}' },
      ActionAfterCompletion: 'NONE',
    });
    await (await create_aws_eventbridge_schedule()).pause_schedule('trg_abc');

    expect(command_at(0)).toBeInstanceOf(GetScheduleCommand);
    expect(command_at(1)).toBeInstanceOf(UpdateScheduleCommand);
    const input = command_input(1);
    expect(input.State).toBe('DISABLED');
    expect(input.ScheduleExpression).toBe('cron(0 9 * * ? *)');
    expect(input.Target).toEqual({ Arn: 'a', RoleArn: 'r', Input: '{}' });
  });

  it('pause ignores a missing schedule and never Updates', async () => {
    send.mockRejectedValueOnce(new ResourceNotFoundException('gone'));
    await expect(
      (await create_aws_eventbridge_schedule()).pause_schedule('trg_x'),
    ).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('delete ignores ResourceNotFoundException but rethrows other errors', async () => {
    send.mockRejectedValueOnce(new ResourceNotFoundException('gone'));
    await expect(
      (await create_aws_eventbridge_schedule()).delete_schedule('trg_x'),
    ).resolves.toBeUndefined();

    send.mockRejectedValueOnce(new Error('denied'));
    await expect(
      (await create_aws_eventbridge_schedule()).delete_schedule('trg_x'),
    ).rejects.toThrow('denied');
  });
});

describe('aws eventbridge adapter — required env', () => {
  beforeEach(() => {
    send.mockReset().mockResolvedValue({});
  });

  it('throws a clear error when the Lambda ARN is missing', async () => {
    vi.resetModules();
    vi.doMock('@coworker/config', () => ({
      env: {
        AWS_REGION: 'us-east-1',
        AWS_SCHEDULER_GROUP: 'default',
        AWS_SCHEDULER_LAMBDA_ARN: undefined,
        AWS_SCHEDULER_ROLE_ARN: 'arn:aws:iam::1:role/sched',
        API_URL: 'https://current-api.example.com',
        COWORKER_API_PROXY_SECRET: 'a-test-secret-at-least-16-chars',
      },
    }));
    vi.doMock('@api/services/scheduling/adapters/aws_credentials', () => ({
      build_aws_credentials: async () => null,
    }));
    const fresh = await import('@api/services/scheduling/adapters/aws_eventbridge');
    await expect(
      (await fresh.create_aws_eventbridge_schedule()).set_schedule(recurring),
    ).rejects.toThrow(/AWS_SCHEDULER_LAMBDA_ARN is required/);
    vi.doUnmock('@coworker/config');
  });

  it('throws a clear error when API_URL is missing', async () => {
    vi.resetModules();
    vi.doMock('@coworker/config', () => ({
      env: {
        AWS_REGION: 'us-east-1',
        AWS_SCHEDULER_GROUP: 'default',
        AWS_SCHEDULER_LAMBDA_ARN: 'arn:aws:lambda:us-east-1:1:function:relay',
        AWS_SCHEDULER_ROLE_ARN: 'arn:aws:iam::1:role/sched',
        API_URL: undefined,
        COWORKER_API_PROXY_SECRET: 'a-test-secret-at-least-16-chars',
      },
    }));
    vi.doMock('@api/services/scheduling/adapters/aws_credentials', () => ({
      build_aws_credentials: async () => null,
    }));
    const fresh = await import('@api/services/scheduling/adapters/aws_eventbridge');
    await expect(
      (await fresh.create_aws_eventbridge_schedule()).set_schedule(recurring),
    ).rejects.toThrow(/API_URL is required/);
    vi.doUnmock('@coworker/config');
  });
});

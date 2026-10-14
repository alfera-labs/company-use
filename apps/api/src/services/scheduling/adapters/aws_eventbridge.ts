import { build_aws_credentials } from '@api/services/scheduling/adapters/aws_credentials';
import { to_aws_schedule_expression } from '@api/services/scheduling/adapters/aws_cron';
import type { CronSchedule } from '@api/services/scheduling/cron_schedule';
import {
  ConflictException,
  CreateScheduleCommand,
  DeleteScheduleCommand,
  GetScheduleCommand,
  type GetScheduleCommandOutput,
  ResourceNotFoundException,
  SchedulerClient,
  UpdateScheduleCommand,
} from '@aws-sdk/client-scheduler';
import { env } from '@coworker/config';
import type { TriggerSchedule } from '@coworker/runtime-platform';

// The AWS EventBridge Scheduler adapter implementing the CronSchedule port. One EventBridge schedule
// per schedulable trigger. EventBridge can't POST to our API directly, so the schedule's target is a
// Lambda (AWS_SCHEDULER_LAMBDA_ARN) that relays the fire to {api_base}/v1/events/{trigger_id} with
// the proxy secret; trigger_id + api_base_url + secret travel in the schedule's Input payload.
//
// One-time tasks (schedule.run_once_at) become at(...) schedules with ActionAfterCompletion=DELETE,
// so AWS removes them after they fire — no orphan cleanup needed.

export async function create_aws_eventbridge_schedule(): Promise<CronSchedule> {
  const credentials = await build_aws_credentials();
  const client = new SchedulerClient({
    region: env.AWS_REGION,
    ...(credentials ? { credentials } : {}),
  });
  const group = env.AWS_SCHEDULER_GROUP;

  return {
    supports_run_once: true,
    set_schedule: (schedule) => create_or_replace_schedule(client, group, schedule),
    pause_schedule: (trigger_id) => set_schedule_state(client, group, trigger_id, 'DISABLED'),
    delete_schedule: (trigger_id) => delete_schedule(client, group, trigger_id),
  };
}

async function create_or_replace_schedule(
  client: SchedulerClient,
  group: string,
  schedule: TriggerSchedule,
) {
  const input = build_create_input(group, schedule);
  try {
    await client.send(new CreateScheduleCommand(input));
  } catch (error) {
    if (!(error instanceof ConflictException)) throw error;
    await client.send(new UpdateScheduleCommand(input));
  }
}

// Pause/resume by flipping State. UpdateSchedule is a full replace, so we must read the current
// schedule and re-send it with the new state — partial updates drop required fields.
async function set_schedule_state(
  client: SchedulerClient,
  group: string,
  trigger_id: string,
  state: 'ENABLED' | 'DISABLED',
) {
  const name = schedule_name(trigger_id);
  let current: GetScheduleCommandOutput;
  try {
    current = await client.send(new GetScheduleCommand({ Name: name, GroupName: group }));
  } catch (error) {
    if (error instanceof ResourceNotFoundException) return;
    throw error;
  }
  await client.send(
    new UpdateScheduleCommand({
      Name: name,
      GroupName: group,
      State: state,
      ScheduleExpression: current.ScheduleExpression,
      ScheduleExpressionTimezone: current.ScheduleExpressionTimezone,
      FlexibleTimeWindow: current.FlexibleTimeWindow,
      Target: current.Target,
      ActionAfterCompletion: current.ActionAfterCompletion,
    }),
  );
}

async function delete_schedule(client: SchedulerClient, group: string, trigger_id: string) {
  try {
    await client.send(
      new DeleteScheduleCommand({ Name: schedule_name(trigger_id), GroupName: group }),
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundException) return;
    throw error;
  }
}

function build_create_input(group: string, schedule: TriggerSchedule) {
  const { expression, timezone } = to_aws_schedule_expression(schedule);
  const is_one_time = Boolean(schedule.run_once_at);
  const api_base_url = current_api_base_url();
  return {
    Name: schedule_name(schedule.trigger_id),
    GroupName: group,
    ScheduleExpression: expression,
    ...(timezone ? { ScheduleExpressionTimezone: timezone } : {}),
    FlexibleTimeWindow: { Mode: 'OFF' as const },
    ActionAfterCompletion: is_one_time ? ('DELETE' as const) : ('NONE' as const),
    Target: {
      Arn: require_lambda_arn(),
      RoleArn: require_role_arn(),
      Input: JSON.stringify({
        trigger_id: schedule.trigger_id,
        api_base_url,
        base_url: api_base_url,
        secret: aws_proxy_secret(),
      }),
    },
  };
}

function schedule_name(trigger_id: string) {
  return `coworker-trigger-${trigger_id}`;
}

function require_lambda_arn() {
  const arn = env.AWS_SCHEDULER_LAMBDA_ARN;
  if (!arn) throw new Error('AWS_SCHEDULER_LAMBDA_ARN is required to schedule triggers on AWS');
  return arn;
}

function require_role_arn() {
  const arn = env.AWS_SCHEDULER_ROLE_ARN;
  if (!arn) throw new Error('AWS_SCHEDULER_ROLE_ARN is required to schedule triggers on AWS');
  return arn;
}

function current_api_base_url(): string {
  const base = env.API_URL;
  if (!base) throw new Error('API_URL is required to schedule triggers on AWS');
  return base.replace(/\/$/, '');
}

function aws_proxy_secret(): string {
  const secret = env.COWORKER_API_PROXY_SECRET;
  if (!secret) throw new Error('COWORKER_API_PROXY_SECRET is required to schedule triggers on AWS');
  return secret;
}

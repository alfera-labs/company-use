import { actor } from 'rivetkit';

const retired_alarm_names = ['sweep_queues', 'fire_due_schedules', 'run_minute_maintenance'];

type CronDelete = { cron: { delete(name: string): Promise<unknown> } };

export const retired_scheduler_actor = actor({
  onWake: async (c) => {
    await delete_alarms_in_order(c, retired_alarm_names);
    c.destroy();
  },
  actions: {},
});

async function delete_alarms_in_order(c: CronDelete, alarm_names: string[]) {
  const [alarm_name, ...rest] = alarm_names;
  if (alarm_name === undefined) return;
  await c.cron.delete(alarm_name);
  await delete_alarms_in_order(c, rest);
}

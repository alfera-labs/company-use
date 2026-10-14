export const recurring_task_protocol = [
  '## Recurring Work Protocol',
  'When the work you just finished is something the user will plainly need again on a rhythm — a weekly report, a daily check, a monthly reconciliation, a digest, a reminder, anything they described with words like every, each, weekly, daily, or "again next" — offer once, at the very end, to run it on a schedule. Name the rhythm you would use and what it would do.',
  'Keep it to one short line after the deliverable. It is an offer, not a question you wait on: finish the answer first, and never open a turn with it.',
  'Write the procedure down before you offer when you did the work yourself: skills/<slug>/SKILL.md holds what doing it taught you — the steps in order, the ids and paths you had to hunt for, what went wrong — because a schedule that rediscovers all of that on every run pays for it every time. Keep SKILL.md short and put any step that needs detail in its own file in the same folder.',
  'When the user asks for a scheduled task outright and no work came before it, the instruction you are about to write IS the procedure, and it is already required to stand alone. Create the task and write no page: a page invented before anything has run is a guess, and the same steps kept in two places drift apart.',
  'Create it only when they accept, using automations-create_automation-1 with a schedule trigger and a self-contained instruction — a scheduled run starts fresh, so it cannot inherit this conversation, its attachments, or anything you are holding in context right now. New standing work is always an automation; scheduled_tasks-create_scheduled_task-1 is only for a one-time run, and existing scheduled tasks keep running as they are.',
  'Put the durable background into that instruction: a few sentences the task will need. Say who asked for it, what it is for, and the standing preferences they stated here, such as always ask before publishing or write to customers in a formal tone. Keep secrets and credentials out of it.',
  'Do not offer when an automation or a scheduled task already covers this work (check with automations-list_automations-1 or scheduled_tasks-list_scheduled_tasks-1 before offering if you have reason to think one exists), when the user already declined it in this conversation, when the task was explicitly one-off, or when the trigger is an event rather than a clock. When you do by hand something one of those would have caught had it covered a little more (another account, another place, another recipient), say so and offer once to widen it. Change it only on their yes.',
].join('\n');

export const scheduled_task_tools = [
  'automations-create_automation-1',
  'scheduled_tasks-create_scheduled_task-1',
  'scheduled_tasks-list_scheduled_tasks-1',
] as const;

export const recurring_work_rail = [
  'Recurring work: if what they just asked for is the kind of thing that comes back — a check, a watch, a report, "every time X happens" — do it first, then end your answer with ONE line offering to set it up as an automation, naming the trigger ("every weekday at 08:00", "every time a Stripe payment fails") and the instruction you would give it.',
  'Check automations-list_automations-1 when you are not sure what already exists, and say nothing when one already listens for that same trigger with a similar instruction. Only call automations-create_automation-1 after they say yes. One line, one offer, never a second time for the same job.',
].join('\n');

export const when_a_script_should_run_on_its_own =
  'A script that runs every week without anyone asking is an automation with a schedule trigger. Load the setting-up-an-automation skill for that; this skill only makes the job itself repeatable.';

export const what_calls_for_an_outward_channel =
  'this conversation or one of your configured automations';

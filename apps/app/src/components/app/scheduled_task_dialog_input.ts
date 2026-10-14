export type CreateScheduledTaskInput = {
  trigger_name: string;
  trigger_type: 'schedule' | 'manual';
  schedule_expression: string | null;
  agent_id?: string;
  trigger_config: Record<string, unknown>;
};

export type UpdateScheduledTaskInput = Omit<CreateScheduledTaskInput, 'agent_id'> & {
  agent_id: string;
};

export type ScheduledTaskFormInput = Omit<UpdateScheduledTaskInput, 'agent_id'> & {
  agent_id: string | null;
};

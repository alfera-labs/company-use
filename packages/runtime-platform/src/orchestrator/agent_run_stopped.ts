export class AgentRunStoppedError extends Error {
  readonly run_id: string;

  constructor(run_id: string) {
    super(`Run ${run_id} stopped because its job moved to another worker.`);
    this.name = 'AgentRunStoppedError';
    this.run_id = run_id;
  }
}

export function is_agent_run_stopped(error: unknown): error is AgentRunStoppedError {
  return error instanceof AgentRunStoppedError;
}

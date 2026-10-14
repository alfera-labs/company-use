export type AutomationCreationGathering = {
  participants: { user: readonly string[] };
  room_private_to: string | null;
};

export function capture_automation_creation_audience(_input: {
  actor_id: string;
  session_id: string | null;
  gathering?: AutomationCreationGathering;
}): Record<string, unknown> {
  return {};
}

export function session_id_of(metadata: Record<string, unknown>): string | null {
  return typeof metadata.session_id === 'string' && metadata.session_id.length > 0
    ? metadata.session_id
    : null;
}

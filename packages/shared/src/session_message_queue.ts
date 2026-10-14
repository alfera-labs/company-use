export function session_queue_key(session_id: string) {
  return `session:${session_id}`;
}

export function is_session_queue_key(queue_key: string) {
  return queue_key.startsWith('session:');
}

export const session_agent_message_job_handler = 'session_agent_message';

export const session_queue_resumed_event_type = 'session.queue_resumed';

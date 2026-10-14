import type { PublicAgent } from '@api/routes/public_agents';
import type { PublicSession } from '@api/services/sessions_api/public_session';
import type { PublicSessionFile } from '@api/services/sessions_api/session_files';
import type { SessionWaitResult, SettledSession } from '@api/services/sessions_api/session_wait';

export function format_agent_for_mcp(agent: PublicAgent) {
  return { slug: agent.slug, name: agent.name, description: agent.description };
}

export function format_session_for_mcp(session: PublicSession) {
  return {
    session_id: session.session_id,
    status: session.status,
    agent: { slug: session.agent.slug, name: session.agent.name },
    title: session.title,
    metadata: session.metadata,
  };
}

export function format_session_snapshot_for_mcp(session: SettledSession) {
  const waits_for_the_person = session.held_tool_calls.length > 0;
  return {
    ...format_session_for_mcp(session),
    status: waits_for_the_person ? 'waiting_for_approval' : session.status,
    last_agent_message: session.last_agent_message,
    ...(waits_for_the_person ? { waiting_for_approval: session.held_tool_calls } : {}),
  };
}

export function format_session_wait_for_mcp(result: SessionWaitResult) {
  if ('wait_timed_out' in result) return result;
  return format_session_snapshot_for_mcp(result);
}

export function format_session_files_for_mcp(
  files: PublicSessionFile[],
  open_in_alfera_url: string,
) {
  return {
    files: files.map((file) => ({
      filename: file.filename,
      mime_type: file.mime_type,
      size_bytes: file.size_bytes,
    })),
    open_in_alfera: open_in_alfera_url,
  };
}

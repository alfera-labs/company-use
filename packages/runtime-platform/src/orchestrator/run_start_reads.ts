import type { Database } from '@coworker/core';
import { workspace_model_access } from '@coworker/core';
import { list_project_members } from '@coworker/core/db/queries/project_members';
import { find_project } from '@coworker/core/db/queries/projects';
import { get_agent, get_session } from '@coworker/core/db/queries/sessions';
import { list_workspace_member_users } from '@coworker/core/db/queries/workspace_membership';
import { count_active_workspace_members } from '@coworker/core/services/workspace_plan';
import { format_person_name, NotFoundError } from '@coworker/shared';
import { read_room_audience } from '@runtime-platform/orchestrator/run_audience';
import { read_run_to_resume } from '@runtime-platform/orchestrator/run_resume';
import { build_workspace_model_environment } from '@runtime-platform/workspace_model_environment';

async function read_project_member_names(
  db: Database,
  workspace_id: string,
  project_id: string,
): Promise<string[]> {
  const [membership, people] = await Promise.all([
    list_project_members(db, { workspace_id, project_id }),
    list_workspace_member_users(db, workspace_id),
  ]);
  const member_ids = new Set(
    membership
      .filter((member) => member.grantee_type === 'user')
      .map((member) => member.grantee_id),
  );
  return people
    .filter((person) => member_ids.has(person.user_id))
    .map((person) => format_person_name(person.first_name, person.last_name, person.email));
}

export function read_model_resolution_inputs(
  db: Database,
  workspace_id: string,
  session: { agent_id: string; project_id: string | null },
) {
  const { project_id } = session;
  return Promise.all([
    get_agent(db, workspace_id, session.agent_id),
    project_id ? find_project(db, { workspace_id, project_id }) : Promise.resolve(null),
    project_id ? read_project_member_names(db, workspace_id, project_id) : Promise.resolve([]),
    build_workspace_model_environment(db, workspace_id),
    workspace_model_access(db, workspace_id),
  ]);
}

export type ModelResolutionInputs = Awaited<ReturnType<typeof read_model_resolution_inputs>>;

type RunStartSession = NonNullable<Awaited<ReturnType<typeof get_session>>>;
type SessionModelKey = { agent_id: string; project_id: string | null };

export type RunStartRecordsInput = {
  workspace_id: string;
  session_id: string;
  resume_run_id?: string;
  read_session?: RunStartSession;
  known_session?: SessionModelKey;
};

function matches_session_model_key(known: SessionModelKey | undefined, session: SessionModelKey) {
  return known?.agent_id === session.agent_id && known.project_id === session.project_id;
}

export async function read_run_start_records(db: Database, input: RunStartRecordsInput) {
  const known_session = input.read_session ?? input.known_session;
  const [session, resumed_run, known_session_reads, workspace_member_count] = await Promise.all([
    input.read_session ?? get_session(db, input.workspace_id, input.session_id),
    input.resume_run_id
      ? read_run_to_resume(db, {
          workspace_id: input.workspace_id,
          session_id: input.session_id,
          run_id: input.resume_run_id,
        })
      : undefined,
    known_session ? read_model_resolution_inputs(db, input.workspace_id, known_session) : undefined,
    count_active_workspace_members(db, input.workspace_id),
  ]);
  if (!session) throw new NotFoundError('Session');
  const model_resolution_inputs =
    known_session_reads && matches_session_model_key(known_session, session)
      ? known_session_reads
      : await read_model_resolution_inputs(db, input.workspace_id, session);
  const [, project] = model_resolution_inputs;
  const room_audience = read_room_audience(session, project, workspace_member_count);
  return { session, resumed_run, model_resolution_inputs, ...room_audience };
}

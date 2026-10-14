import { api_client, no_store_request, read_api_data } from '@/lib/api/client';
import type { ApiSuccess } from '@/lib/api/types';

type WorkspaceSlackPeopleClient = (typeof api_client.v1.workspace)['slack-people']['$get'];

export type WorkspaceSlackPeople = ApiSuccess<WorkspaceSlackPeopleClient>;

export type WorkspaceSlackPerson = WorkspaceSlackPeople['people'][number];

export async function list_workspace_slack_people(): Promise<WorkspaceSlackPeople> {
  return read_api_data<WorkspaceSlackPeople>(
    await api_client.v1.workspace['slack-people'].$get(undefined, no_store_request),
    { method: 'GET', path: '/v1/workspace/slack-people' },
  );
}

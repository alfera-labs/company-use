import type { InferResponseType } from 'hono/client';
import { api_client, no_store_request, read_api_data } from '@/lib/api/client';

const trigger_field_choices_client =
  api_client.v1.automations['trigger-types'][':node_key'].fields[':field'].choices;

type ApiSuccess<T> = InferResponseType<T, 200> extends { data: infer Data } ? Data : never;

export type TriggerFieldChoice = ApiSuccess<
  typeof trigger_field_choices_client.$get
>['choices'][number];

export async function list_trigger_field_choices(
  node_key: string,
  field: string,
  connection_id: string,
): Promise<TriggerFieldChoice[]> {
  const { choices } = await read_api_data<{ choices: TriggerFieldChoice[] }>(
    await trigger_field_choices_client.$get(
      { param: { node_key, field }, query: { connection_id } },
      no_store_request,
    ),
    { method: 'GET', path: `/v1/automations/trigger-types/${node_key}/fields/${field}/choices` },
  );
  return choices;
}

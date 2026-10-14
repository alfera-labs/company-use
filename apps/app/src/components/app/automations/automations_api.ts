import type { InferRequestType, InferResponseType } from 'hono/client';
import { api_client, no_store_request, read_api_data } from '@/lib/api/client';
import { create_random_id } from '@/lib/random_id';

type ApiData<T> = T extends { data: infer Data } ? Data : never;
type ApiSuccess<T> = ApiData<InferResponseType<T, 200 | 201>>;
type ArrayItem<T> = T extends readonly (infer Item)[] ? Item : never;

const automation_by_id_client = api_client.v1.automations[':automation_id'];
const trigger_types_client = api_client.v1.automations['trigger-types'];
const notification_rules_client = api_client.v1['notification-rules'];

export type AutomationListItem = ArrayItem<ApiSuccess<typeof api_client.v1.automations.$get>>;
export type AutomationWithTriggers = ApiSuccess<typeof automation_by_id_client.$get>;
export type AutomationTrigger = AutomationWithTriggers['triggers'][number];
type AutomationRunPage = ApiSuccess<typeof automation_by_id_client.runs.$get>;
export type AutomationFirePage = ApiSuccess<typeof automation_by_id_client.fires.$get>;
export type AutomationFire = AutomationFirePage['items'][number];
export type NotificationPage = ApiSuccess<typeof api_client.v1.notifications.$get>;
export type Notification = NotificationPage['items'][number];
export type NotificationRulesRead = ApiSuccess<typeof notification_rules_client.$get>;
export type NotificationRules = NotificationRulesRead['policy'];

export type TriggerTypeCatalog = ApiSuccess<typeof trigger_types_client.$get>;
export type TriggerTypeApp = TriggerTypeCatalog['apps'][number];
export type TriggerTypeRow = TriggerTypeApp['trigger_types'][number];

export type AutomationCreateBody = InferRequestType<typeof api_client.v1.automations.$post>['json'];
export type AutomationUpdateBody = InferRequestType<typeof automation_by_id_client.$patch>['json'];
export type AutomationTriggerInput = AutomationCreateBody['triggers'][number];
export type AutomationRule = NonNullable<
  Extract<AutomationTriggerInput, { kind: 'app_event' }>['conditions']
>[number];

export async function list_automations(): Promise<AutomationListItem[]> {
  return read_api_data(await api_client.v1.automations.$get(undefined, no_store_request), {
    method: 'GET',
    path: '/v1/automations',
  });
}

export async function get_automation(automation_id: string): Promise<AutomationWithTriggers> {
  return read_api_data(await automation_by_id_client.$get({ param: { automation_id } }), {
    method: 'GET',
    path: `/v1/automations/${automation_id}`,
  });
}

export async function list_automation_runs(
  automation_id: string,
  query: { page: number; page_size: number },
): Promise<AutomationRunPage> {
  return read_api_data(
    await automation_by_id_client.runs.$get({
      param: { automation_id },
      query: { page: String(query.page), page_size: String(query.page_size) },
    }),
    { method: 'GET', path: `/v1/automations/${automation_id}/runs` },
  );
}

export async function list_automation_fires(
  automation_id: string,
  query: { page: number; page_size: number },
): Promise<AutomationFirePage> {
  return read_api_data(
    await automation_by_id_client.fires.$get({
      param: { automation_id },
      query: { page: String(query.page), page_size: String(query.page_size) },
    }),
    { method: 'GET', path: `/v1/automations/${automation_id}/fires` },
  );
}

export async function list_trigger_types(): Promise<TriggerTypeCatalog> {
  return read_api_data(await trigger_types_client.$get(undefined, no_store_request), {
    method: 'GET',
    path: '/v1/automations/trigger-types',
  });
}

export async function create_automation(
  body: AutomationCreateBody,
): Promise<AutomationWithTriggers> {
  return read_api_data(await api_client.v1.automations.$post({ json: body }), {
    method: 'POST',
    path: '/v1/automations',
  });
}

export async function update_automation(
  automation_id: string,
  body: AutomationUpdateBody,
): Promise<AutomationWithTriggers> {
  return read_api_data(
    await automation_by_id_client.$patch({ param: { automation_id }, json: body }),
    { method: 'PATCH', path: `/v1/automations/${automation_id}` },
  );
}

export type AutomationDeleteAnswer = ApiSuccess<typeof automation_by_id_client.$delete>;

export async function delete_automation(automation_id: string): Promise<AutomationDeleteAnswer> {
  return read_api_data(await automation_by_id_client.$delete({ param: { automation_id } }), {
    method: 'DELETE',
    path: `/v1/automations/${automation_id}`,
  });
}

export async function provision_automation(automation_id: string): Promise<AutomationWithTriggers> {
  return read_api_data(
    await automation_by_id_client.provision.$post({ param: { automation_id } }),
    {
      method: 'POST',
      path: `/v1/automations/${automation_id}/provision`,
    },
  );
}

export async function set_automation_status(
  automation_id: string,
  automation_status: 'enabled' | 'paused',
): Promise<AutomationWithTriggers> {
  return read_api_data(
    await automation_by_id_client.$patch({ param: { automation_id }, json: { automation_status } }),
    { method: 'PATCH', path: `/v1/automations/${automation_id}` },
  );
}

export async function run_automation_now(automation_id: string) {
  return read_api_data(
    await automation_by_id_client['run-now'].$post({
      param: { automation_id },
      json: { occurrence_key: create_random_id() },
    }),
    { method: 'POST', path: `/v1/automations/${automation_id}/run-now` },
  );
}

type NotificationsQueryInput = NonNullable<
  InferRequestType<typeof api_client.v1.notifications.$get>['query']
>;
export type NotificationOutcome = Extract<NonNullable<NotificationsQueryInput['outcome']>, string>;

export type NotificationQuery = {
  automation_id?: string | undefined;
  outcome?: NotificationOutcome[] | undefined;
  only_open?: boolean | undefined;
  days?: number | undefined;
  q?: string | undefined;
  page?: number | undefined;
  page_size?: number | undefined;
};

export async function list_notifications(query: NotificationQuery = {}): Promise<NotificationPage> {
  return read_api_data(
    await api_client.v1.notifications.$get(
      {
        query: {
          ...(query.automation_id ? { automation_id: query.automation_id } : {}),
          ...(query.outcome ? { outcome: query.outcome } : {}),
          ...(query.only_open === undefined
            ? {}
            : { open: query.only_open ? ('true' as const) : ('false' as const) }),
          ...(query.days ? { days: String(query.days) } : {}),
          ...(query.q ? { q: query.q } : {}),
          page: String(query.page ?? 1),
          page_size: String(query.page_size ?? 25),
        },
      },
      no_store_request,
    ),
    { method: 'GET', path: '/v1/notifications' },
  );
}

export async function end_notification(
  notification_event_id: string,
  ending: 'dismiss' | 'act',
): Promise<Notification> {
  const endpoint = api_client.v1.notifications[':notification_event_id'][ending];
  return read_api_data(await endpoint.$post({ param: { notification_event_id } }), {
    method: 'POST',
    path: `/v1/notifications/${notification_event_id}/${ending}`,
  });
}

export async function read_notification_rules(): Promise<NotificationRulesRead> {
  return read_api_data(await notification_rules_client.$get(undefined, no_store_request), {
    method: 'GET',
    path: '/v1/notification-rules',
  });
}

export type NotificationRulesChange = Parameters<
  typeof notification_rules_client.$patch
>[0]['json'];

export async function save_notification_rules(changes: NotificationRulesChange) {
  return read_api_data(await notification_rules_client.$patch({ json: changes }), {
    method: 'PATCH',
    path: '/v1/notification-rules',
  });
}

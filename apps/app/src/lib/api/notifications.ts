import { api_client, no_store_request, read_api_data } from '@/lib/api/client';
import type { ApiSuccess } from '@/lib/api/types';

export type InboxNotificationPage = ApiSuccess<typeof api_client.v1.notifications.$get>;
export type InboxNotification = InboxNotificationPage['items'][number];

export type InboxNotificationQuery = {
  only_open?: boolean | undefined;
  days?: number | undefined;
  q?: string | undefined;
  page?: number | undefined;
  page_size?: number | undefined;
};

export async function list_notifications(
  query: InboxNotificationQuery = {},
): Promise<InboxNotificationPage> {
  return read_api_data(
    await api_client.v1.notifications.$get(
      {
        query: {
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

export async function dismiss_notification(
  notification_event_id: string,
): Promise<InboxNotification> {
  return read_api_data(
    await api_client.v1.notifications[':notification_event_id'].dismiss.$post({
      param: { notification_event_id },
    }),
    { method: 'POST', path: `/v1/notifications/${notification_event_id}/dismiss` },
  );
}

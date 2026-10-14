import { resolve_workos_client } from '@api/lib/workos_client';

export type WorkosWebhookEvent = {
  event: string;
  data: {
    id?: string;
    userId?: string;
    organizationId?: string;
    status?: string;
    role?: { slug?: string } | null;
  };
};

export const membership_event_types = new Set([
  'organization_membership.created',
  'organization_membership.updated',
  'organization_membership.deleted',
]);

export async function construct_workos_event(input: {
  payload: string;
  signature: string;
  secret: string;
}): Promise<WorkosWebhookEvent> {
  const workos = resolve_workos_client();
  if (!workos) throw new Error('WORKOS_API_KEY unset — cannot verify webhook');
  const event = await workos.webhooks.constructEvent({
    payload: input.payload,
    sigHeader: input.signature,
    secret: input.secret,
  });
  return event as unknown as WorkosWebhookEvent;
}

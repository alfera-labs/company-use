import { app_needs_a_connection } from '@shared/catalog_app_kind';

export function describe_the_action(action_name: string) {
  return action_name.replaceAll('_', ' ').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function describe_the_action_in_place(action_name: string, place_name?: string | undefined) {
  const action = describe_the_action(action_name);
  if (!place_name || action.includes(place_name.toLowerCase())) return action;
  return `${action} in ${place_name}`;
}

export function describe_approval_call(call: {
  action_display_name?: string | null;
  node_key: string;
  app_display_name?: string | null;
  app_auth_type?: string | null;
}) {
  const place_name = app_needs_a_connection(call.app_auth_type) ? call.app_display_name : null;
  return describe_the_action_in_place(
    call.action_display_name ?? call.node_key,
    place_name ?? undefined,
  );
}

export function yes_label(_action_name?: string) {
  return 'Yes, go ahead';
}

export function no_label(_action_name?: string) {
  return "No, don't";
}

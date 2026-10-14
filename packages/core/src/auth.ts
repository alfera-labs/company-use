export type AuthenticatedActor = {
  user_id: string;
  workspace_id: string;
};

export function create_local_actor(input: AuthenticatedActor) {
  return input;
}

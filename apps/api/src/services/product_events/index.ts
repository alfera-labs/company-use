export type ProductEvents = {
  user_signed_up: { workspace_id: string; joined_existing_workspace: boolean };
  workspace_created: { workspace_id: string; is_first_workspace: boolean };
  onboarding_completed: { workspace_id: string };
};

export type ProductEventName = keyof ProductEvents;

export type ProductEventPerson = {
  distinct_id: string;
  email?: string | null;
  name?: string | null;
};

export async function capture_product_event<Name extends ProductEventName>(_input: {
  person: ProductEventPerson;
  event: Name;
  properties: ProductEvents[Name];
  event_id?: string;
  timestamp?: Date;
}): Promise<void> {}

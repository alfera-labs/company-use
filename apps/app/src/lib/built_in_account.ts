import type { WorkosUser } from '@/lib/workos_session';

/**
 * A person this install knows by itself, in the shape the rest of the app reads a signed-in
 * person in. Local mode and team mode have no sign-in provider, so there is no email and no
 * picture to show.
 */
export function built_in_account(person: {
  id: string;
  first_name: string | null;
  last_name: string | null;
}): WorkosUser {
  const created_at = '2000-01-01T00:00:00.000Z';
  return {
    object: 'user',
    id: person.id,
    email: '',
    emailVerified: true,
    profilePictureUrl: null,
    firstName: person.first_name,
    lastName: person.last_name,
    name: [person.first_name, person.last_name].filter(Boolean).join(' ') || null,
    lastSignInAt: null,
    locale: null,
    createdAt: created_at,
    updatedAt: created_at,
    externalId: null,
    metadata: {},
  };
}

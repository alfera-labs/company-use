import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { read_template_listing } from '@/lib/templates_api';
import { read_signed_in_workos_auth } from '@/lib/workos_session';

/**
 * The Add button. It installs nothing itself: it opens a chat seeded with the template's
 * instruction and lets the agent run the setup — ask the open questions, then create the
 * scheduled task or save the skill through the same paths it uses when a person asks.
 *
 * The server half only resolves the instruction and returns where to go; the caller navigates,
 * because a client-side navigation keeps the app shell mounted.
 */
export const resolve_setup_chat_path = createServerFn({ method: 'POST' })
  .validator(z.object({ slug: z.string().min(1) }))
  .handler(async ({ data }): Promise<string | null> => {
    await read_signed_in_workos_auth();
    const listing = await read_template_listing(data.slug);
    if (!listing) return null;

    // The message travels as a query param the composer already reads (/home?prompt=).
    // Move to a storage draft if instructions ever outgrow a URL.
    return `/home?prompt=${encodeURIComponent(listing.setup_message)}`;
  });

// Writes the catalogs this repo ships in code — the internal runtime app, the native runtime
// tools, and the native connector apps — into `apps` and `nodes`. Nothing in the API writes
// catalog rows on its own: an operator runs this once per database (and again after a deploy
// that adds or changes a native tool), the same way migrations are run.
//
//   bun run catalog:seed local    # this worktree's database
//   bun run catalog:seed dev      # the shared development database
//   bun run catalog:seed prod     # production
//
// Provider catalogs are separate one-shot scripts, one for each provider:
// sync-<provider>-catalog.ts.

import { close_database, get_database } from '@coworker/core/db/connection';
import { seed_native_catalogs } from '@coworker/runtime-platform';

try {
  await seed_native_catalogs(get_database());
  console.log('seeded the internal runtime, native runtime tool, and native connector catalogs');
} finally {
  await close_database();
}

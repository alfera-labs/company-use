import { resolve } from 'node:path';
import { close_database, get_database } from '@coworker/core/db/connection';
import { templates } from '@coworker/core/db/schema';
import { publish_library } from '@coworker/core/templates/publish_from_folder';

// Publishes every folder in packages/core/src/templates/library into `templates`.
// Re-running is safe: a slug that already exists is republished as the next version.
// `--only-when-empty` publishes nothing when the table already has a row. The self-host
// stack runs it on every start, and a start must not publish a new version each time.

const library_path = resolve(
  import.meta.dirname,
  '../packages/core/src/templates/library',
);

async function library_is_published() {
  const rows = await get_database().select({ template_slug: templates.template_slug }).from(templates).limit(1);
  return rows.length > 0;
}

async function main() {
  if (process.argv.includes('--only-when-empty') && (await library_is_published())) {
    console.log('the template library is already published');
    return;
  }
  const published = await publish_library(get_database(), {
    library_path,
    actor_id: 'system:seed_library',
  });
  const tasks = published.filter((listing) => listing.template_kind === 'task').length;
  const ready = published.filter((listing) => listing.listing_state === 'ready').length;
  console.log(
    `published ${published.length} listings — ${tasks} tasks, ${published.length - tasks} skills, ${ready} ready`,
  );
}

try {
  await main();
} finally {
  await close_database();
}

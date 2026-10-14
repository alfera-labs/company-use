import { require_database_url } from '@coworker/config';
import { create_database } from '@coworker/core/db/connection';
import {
  list_members_without_a_personal_room,
  open_personal_project,
} from '@coworker/core/db/queries/personal_projects';

// Give everyone who joined before rooms existed the room of their own that every member gets now.
//
// YOU run this. It never runs on deploy. Opening a room is idempotent — the unique index makes a
// second attempt read the first one back — so this can be re-run or ignored safely.
//
//   bun run backfill:personal-rooms                 # report only, local
//   bun run backfill:personal-rooms --write         # open the rooms, local
//   bun run backfill:personal-rooms:prod            # report only, production
//
// Nothing is shared by this: a personal room starts private to one person, and stays that way
// until somebody is added to it.

const should_write = process.argv.includes('--write');

async function main() {
  const db = create_database(require_database_url());
  const members = await list_members_without_a_personal_room(db);

  for (const member of members) {
    console.log(
      `${should_write ? 'opening' : 'would open'} a room for ${member.user_id} in ${member.workspace_id}`,
    );
    if (should_write) await open_personal_project(db, member);
  }

  console.log(
    `\n${members.length} member(s) without a room, ` +
      `${should_write ? `${members.length} opened` : 'nothing written (pass --write)'}`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

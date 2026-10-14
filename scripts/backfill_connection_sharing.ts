import { require_database_url } from '@coworker/config';
import { create_database } from '@coworker/core/db/connection';
import { move_connection_allow_lists_to_grants } from '@coworker/core/db/queries/connection_allow_lists';

// Move every restricted connection's allow-list out of connection_config JSONB and into
// resource_grants rows, so one gate answers "may this gathering use it" for every resource.
//
// YOU run this. It never runs on deploy, and it is additive in both directions: the old JSONB
// block is left exactly where it is, and each person is written as one grant row, so a connection
// that is ALSO scoped to a project keeps that row. Re-running it changes nothing.
//
//   bun run backfill:connection-sharing                    # report only, local
//   bun run backfill:connection-sharing --write            # write the rows, local
//   bun run backfill:connection-sharing:prod               # report only, production
//
// Run it BEFORE the deploy that retires the JSONB gate, and only against an installation that
// records a speaker on every surface. The grants this writes are read by the participant gate,
// and a surface that names nobody is refused every resource restricted to named people. Skipping
// it does the opposite of hiding: with the JSONB gate gone, an unmigrated private connection is
// open to the whole workspace. See record_platform_user_as_speaker.

const should_write = process.argv.includes('--write');

async function main() {
  const db = create_database(require_database_url());
  const moves = await move_connection_allow_lists_to_grants(db, { write: should_write });

  for (const move of moves) {
    console.log(
      `${should_write ? 'wrote' : 'would write'} ${move.grants} row(s) for ` +
        `${move.connection_id} (${move.connection_name ?? 'unnamed'})`,
    );
  }

  const written_count = moves.reduce((total, move) => total + move.grants, 0);
  console.log(
    `\n${moves.length} connection(s) still carrying an allow-list, ` +
      `${should_write ? `${written_count} grant rows written` : 'nothing written (pass --write)'}`,
  );
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

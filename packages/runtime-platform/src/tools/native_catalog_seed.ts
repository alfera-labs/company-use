import { seed_connector_catalog } from '@coworker/connectors';
import type { Database } from '@coworker/core';
import { register_alfera_api_catalog } from '@coworker/core/db/queries/alfera_api_connection';
import { seed_internal_catalog } from '@coworker/core/db/queries/catalog';
import { seed_attio_trigger_catalog } from '@runtime-platform/tools/attio_trigger_seed';
import { seed_runtime_tool_catalog } from '@runtime-platform/tools/catalog_seed';
import { seed_native_trigger_catalog } from '@runtime-platform/tools/native_trigger_seed';

export async function seed_native_catalogs(db: Database) {
  await seed_internal_catalog(db);
  await seed_runtime_tool_catalog(db);
  await seed_connector_catalog(db);
  await seed_native_trigger_catalog(db);
  await seed_attio_trigger_catalog(db);
  await register_alfera_api_catalog(db);
}

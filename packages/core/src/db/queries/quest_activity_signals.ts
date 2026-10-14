import { triggers } from '@coworker/core/db/schema';
import { sql } from 'drizzle-orm';

export const not_system_provisioned = sql`${triggers.trigger_source} ->> 'kind' IS DISTINCT FROM 'system'`;

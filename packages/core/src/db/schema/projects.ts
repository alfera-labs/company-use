import { lifecycle_columns, metadata } from '@coworker/core/db/schema/common';
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';

export const projects = pgTable(
  'projects',
  {
    project_id: text('project_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    project_name: text('project_name').notNull(),
    project_status: text('project_status').notNull().default('active'),
    project_access: text('project_access').notNull().default('members'),
    is_workspace_default: boolean('is_workspace_default').notNull().default(false),
    project_description: text('project_description'),
    project_instructions: text('project_instructions'),
    membership_version: bigint('membership_version', { mode: 'number' }).notNull().default(1),
    personal_for_user_id: text('personal_for_user_id'),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    check('projects_status_check', sql`${table.project_status} IN ('active','archived')`),
    check(
      'projects_access_check',
      sql`${table.project_access} IN ('private','members','workspace')`,
    ),
    check(
      'projects_private_owner_check',
      sql`${table.project_access} <> 'private' OR ${table.personal_for_user_id} IS NOT NULL`,
    ),
    check(
      'projects_personal_access_check',
      sql`${table.personal_for_user_id} IS NULL OR ${table.project_access} = 'private'`,
    ),
    check(
      'projects_workspace_default_access_check',
      sql`NOT ${table.is_workspace_default} OR ${table.project_access} = 'workspace'`,
    ),
    uniqueIndex('idx_projects_name_unique')
      .on(table.workspace_id, sql`lower(${table.project_name})`)
      .where(sql`${table.project_status} = 'active' AND ${table.personal_for_user_id} IS NULL`),
    uniqueIndex('idx_projects_personal_unique')
      .on(table.workspace_id, table.personal_for_user_id)
      .where(sql`${table.personal_for_user_id} IS NOT NULL`),
    uniqueIndex('idx_projects_workspace_default_unique')
      .on(table.workspace_id)
      .where(sql`${table.is_workspace_default}`),
    index('idx_projects_workspace_status_name').on(
      table.workspace_id,
      table.project_status,
      sql`lower(${table.project_name})`,
    ),
  ],
);

export const resource_grants = pgTable(
  'resource_grants',
  {
    resource_grant_id: text('resource_grant_id').primaryKey(),
    workspace_id: text('workspace_id').notNull(),
    resource_type: text('resource_type').notNull(),
    resource_id: text('resource_id').notNull(),
    grantee_type: text('grantee_type').notNull(),
    grantee_id: text('grantee_id').notNull(),
    grant_level: text('grant_level').notNull().default('use'),
    metadata: metadata(),
    ...lifecycle_columns,
  },
  (table) => [
    check('resource_grants_level_check', sql`${table.grant_level} IN ('use','manage')`),
    check(
      'resource_grants_grantee_check',
      sql`${table.grantee_type} IN ('project','user','agent','source_actor','api_key')`,
    ),
    uniqueIndex('idx_resource_grants_unique').on(
      table.workspace_id,
      table.resource_type,
      table.resource_id,
      table.grantee_type,
      table.grantee_id,
    ),
    index('idx_resource_grants_resource').on(
      table.workspace_id,
      table.resource_type,
      table.resource_id,
    ),
    index('idx_resource_grants_grantee').on(
      table.workspace_id,
      table.grantee_type,
      table.grantee_id,
    ),
  ],
);

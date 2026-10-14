-- Projects, and the one edge that says who may use what.
--
-- Two tables replace four competing answers to "may this run use this thing?":
-- workspace_members.member_role, connections.connection_config.allowed_users, agent_nodes, and
-- the memory ACL. Nothing here changes any of those yet — with zero rows in resource_grants the
-- gate answers "allowed" for every resource whose registry default is everyone_in_the_workspace,
-- so every existing workspace behaves exactly as it did before this migration.
--
-- A membership and a permission are the same row shape — (this thing) is allowed for (this
-- party) at (this level) — so both live in resource_grants. "Alice is in project P" is
-- (resource_type='project', resource_id=P, grantee_type='user', grantee_id=alice).
--
-- Absence of rows for a resource is the shared default and the ONLY spelling of "shared".
-- The table therefore holds exceptions, never an enumeration: 5,000 projects times 40
-- connections would be 200,000 rows nobody maintains.
--
-- Idempotent: every statement is safe to re-run.
CREATE TABLE IF NOT EXISTS "projects" (
  "project_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "project_name" text NOT NULL,
  "project_status" text DEFAULT 'active' NOT NULL,
  -- Bumped in the SAME transaction as every membership write, INCLUDING deletes. A removal is
  -- a row DELETE, so no surviving row's timestamp advances and a max(last_updated_time)
  -- watermark can go BACKWARDS on a removal. The epoch is the only cache key revocation can
  -- use.
  "roster_version" bigint DEFAULT 1 NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_time" timestamp with time zone DEFAULT now() NOT NULL,
  "last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text NOT NULL,
  "last_updated_by" text NOT NULL,
  CONSTRAINT "projects_status_check" CHECK ("project_status" IN ('active','archived'))
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_projects_name_unique"
  ON "projects" USING btree ("workspace_id", lower("project_name"))
  WHERE "project_status" = 'active';--> statement-breakpoint

-- The admin list at thousands of projects: name-ordered paging with no sort step.
CREATE INDEX IF NOT EXISTS "idx_projects_workspace_status_name"
  ON "projects" USING btree ("workspace_id","project_status", lower("project_name"));--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "resource_grants" (
  "resource_grant_id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  -- Two explicit columns, never one sniffed "connection:conn_7" string. No CHECK on
  -- resource_type: it is an open registry (packages/core/src/access/resource_types.ts), so a
  -- new resource type costs a registry entry rather than a migration. The CHECKs in this
  -- schema fence closed lifecycles; this axis is deliberately open.
  "resource_type" text NOT NULL,
  "resource_id" text NOT NULL,
  "grantee_type" text NOT NULL,
  "grantee_id" text NOT NULL,
  "grant_level" text DEFAULT 'use' NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_time" timestamp with time zone DEFAULT now() NOT NULL,
  "last_updated_time" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" text NOT NULL,
  "last_updated_by" text NOT NULL,
  CONSTRAINT "resource_grants_level_check" CHECK ("grant_level" IN ('use','manage')),
  CONSTRAINT "resource_grants_grantee_check"
    CHECK ("grantee_type" IN ('project','user','agent'))
);--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_resource_grants_unique"
  ON "resource_grants" USING btree
  ("workspace_id","resource_type","resource_id","grantee_type","grantee_id");--> statement-breakpoint

-- "Who may use this resource" — the runtime gate, and the who-may-use-what page.
CREATE INDEX IF NOT EXISTS "idx_resource_grants_resource"
  ON "resource_grants" USING btree ("workspace_id","resource_type","resource_id");--> statement-breakpoint

-- "What may this party use" — the project page, and offboarding one person in one scan.
CREATE INDEX IF NOT EXISTS "idx_resource_grants_grantee"
  ON "resource_grants" USING btree ("workspace_id","grantee_type","grantee_id");

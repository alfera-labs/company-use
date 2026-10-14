import type { RatchetRuleSample } from '@scripts/ratchet/rule_types';

export const import_direction_fixtures: readonly RatchetRuleSample[] = [
  {
    file_path: 'packages/agent-core/src/harness/sample.ts',
    source_text: [
      "import { create_usage_record } from '@coworker/core';",
      "import type { Database } from '../../../core/src/db/connection';",
      "const runtime = await import('@coworker/runtime-platform');",
      "import { create_id } from '@coworker/shared';",
    ].join('\n'),
    expected_count: 3,
  },
  {
    file_path: 'packages/core/src/sample.ts',
    source_text: "import type { AgentRun } from '@agent-core/runs';\nimport { env } from '@coworker/config';\n",
    expected_count: 1,
  },
  {
    file_path: 'packages/runtime-platform/src/tools/sample.ts',
    source_text: [
      "import { list_triggers } from '@api/services/triggers';",
      "import { read_env } from '@agent-core/environment/sample_internal_file';",
      "import { create_agent_run } from '@agent-core/runs/create_agent_run';",
    ].join('\n'),
    expected_count: 1,
  },
  {
    file_path: 'apps/api/src/routes/sample.ts',
    source_text: [
      "import { run_tool } from '@runtime-platform/tools/sample_tool';",
      "import { start_run } from '@coworker/runtime-platform';",
      "import { find_rows } from '@coworker/core/db/queries/sample_queries';",
      "import { readFile } from 'node:fs/promises';",
    ].join('\n'),
    expected_count: 0,
  },
  {
    file_path: 'apps/app/src/components/sample.tsx',
    source_text: [
      "import postgres from 'postgres';",
      "import { readFileSync } from 'node:fs';",
      "import { WorkOS } from '@workos-inc/node';",
      "import { env } from '@coworker/config';",
      "import { api_app } from '@coworker/api';",
      "import type { AppType } from '@coworker/api';",
      "import { public_env } from '@coworker/config/public_env';",
      "import { hc } from 'hono/client';",
      "import { Button } from '@coworker/ui/components/button';",
      "import { route } from '@/routes/sample';",
    ].join('\n'),
    expected_count: 5,
  },
  {
    file_path: 'apps/app/src/lib/sample_session.server.ts',
    source_text: "import { WorkOS } from '@workos-inc/node';\nimport { env } from '@coworker/config';\n",
    expected_count: 0,
  },
  {
    file_path: 'apps/app/src/lib/sample_marker.ts',
    source_text: "import '@tanstack/react-start/server-only';\nimport { readFileSync } from 'node:fs';\n",
    expected_count: 0,
  },
  {
    file_path: 'apps/app/src/lib/__tests__/sample.test.ts',
    source_text: "import { createServer } from 'node:http';\n",
    expected_count: 0,
  },
  {
    file_path: 'packages/shared/src/sample.ts',
    source_text: "import { randomUUID } from 'node:crypto';\nimport { Button } from '@coworker/ui/components/button';\n",
    expected_count: 2,
  },
  {
    file_path: 'packages/sample-new-package/src/index.ts',
    source_text: "import { create_id } from '@coworker/shared';\n",
    expected_count: 1,
  },
];

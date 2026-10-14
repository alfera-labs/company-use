import { create_app } from '@api/app';
import { mcp_client_scopes } from '@api/lib/mcp_oauth';
import { brain_mcp_tools } from '@api/routes/brain/mcp_tools';
import { all_api_key_scopes } from '@api/services/api_keys';
import { build_public_api_openapi_document } from '@api/services/openapi/public_api_openapi';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { create_api_key } from '@coworker/core/db/queries/api_keys';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import {
  alfera_api_tool_groups,
  alfera_api_tools,
} from '@coworker/core/integrations/alfera_api_tools';
import { slack_read_history_tool } from '@runtime-platform/tools/slack/read_history';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const names_of_features_on_alfera_cloud =
  /memory|get_usage|ask_agent|wait_for_answer|credit|search_documents/iu;
const scopes_of_features_on_alfera_cloud = /^(answers|memory|usage)\./u;

const initialize_result_schema = z.looseObject({
  result: z.looseObject({ instructions: z.string() }),
});

async function read_mcp_instructions() {
  const db = await create_test_database();
  const bootstrap = await bootstrap_default_workspace(db);
  const { secret } = await create_api_key(db, {
    workspace_id: bootstrap.workspace_id,
    key_name: 'surface key',
    scopes: ['sessions.read'],
    key_audience: 'internal',
    environment_label: 'test',
    actor_id: bootstrap.user_id,
  });
  const response = await create_app(db).request('/v1/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  return initialize_result_schema.parse(await response.json()).result.instructions;
}

describe('what this edition offers and describes', () => {
  it('lists no MCP tool of a feature that runs on Alfera Cloud, and describes none', async () => {
    const tools = Object.entries(brain_mcp_tools);

    expect(tools.map(([tool_name]) => tool_name)).toEqual(
      expect.arrayContaining([
        'whoami',
        'create_session',
        'list_integrations',
        'list_skills',
        'list_automations',
      ]),
    );
    for (const [tool_name, tool] of tools) {
      expect(`${tool_name} ${tool.description}`).not.toMatch(names_of_features_on_alfera_cloud);
    }
    expect(await read_mcp_instructions()).not.toMatch(names_of_features_on_alfera_cloud);
  });

  it('describes no public API path of a feature that runs on Alfera Cloud', () => {
    const document = build_public_api_openapi_document();
    const described = [
      ...Object.keys(document.paths ?? {}),
      ...Object.keys(document.components?.schemas ?? {}),
    ];

    expect(described).toContain('/v1/sessions');
    expect(described).toContain('/v1/automations');
    for (const name of described) {
      expect(name).not.toMatch(/memory|answers|usage|credits/iu);
    }
  });

  it('lists no built-in API tool of a feature that runs on Alfera Cloud', () => {
    const listed = [
      ...alfera_api_tool_groups.map((group) => `${group.group_key} ${group.description}`),
      ...alfera_api_tools.map((tool) => `${tool.tool_name} ${tool.description}`),
    ];

    expect(listed.length).toBeGreaterThan(10);
    expect(alfera_api_tools.map((tool) => tool.tool_name)).toContain('create_automation');
    for (const entry of listed) expect(entry).not.toMatch(names_of_features_on_alfera_cloud);
  });

  it('offers no API key scope of a feature that runs on Alfera Cloud', () => {
    expect(all_api_key_scopes).toContain('sessions.write');
    expect(all_api_key_scopes).toContain('automations.write');
    for (const scope of [...all_api_key_scopes, ...mcp_client_scopes]) {
      expect(scope).not.toMatch(scopes_of_features_on_alfera_cloud);
    }
  });

  it('sends the model to no company-memory tool from the Slack history tool', () => {
    expect(slack_read_history_tool.description).not.toMatch(names_of_features_on_alfera_cloud);
  });
});

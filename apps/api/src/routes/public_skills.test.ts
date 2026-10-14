import { create_app } from '@api/app';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import {
  type ApiKeyAudience,
  type ApiKeyScope,
  create_api_key,
} from '@coworker/core/db/queries/api_keys';
import { bootstrap_default_workspace } from '@coworker/core/db/queries/bootstrap';
import { create_volume } from '@coworker/core/db/queries/volumes';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const volume_objects = vi.hoisted(() => ({ index_text: '' }));

vi.mock('@runtime-platform/storage/volume_objects', async (import_original) => ({
  ...(await import_original<typeof import('@runtime-platform/storage/volume_objects')>()),
  read_archil_volume_bytes: async () => new TextEncoder().encode(volume_objects.index_text),
  list_archil_volume_folders: async () => [],
}));

type App = ReturnType<typeof create_app>;
type Skill = { skill_id: string; name: string; description: string; source: string };

let db: Database;
let app: App;
let workspace_id: string;
let actor_id: string;

function procedure_index(skill_slug: string, skill_hint: string) {
  return JSON.stringify({
    skill_index_version: 1,
    compiled_time: '2026-09-20T10:00:00.000Z',
    entries: [
      {
        skill_slug,
        skill_name: 'Quote drafting',
        skill_hint,
        body_path: `skills/${skill_slug}/SKILL.md`,
        content_hash: 'sha256:test',
        preloaded_tool_keys: [],
        available_on_source_types: null,
      },
    ],
  });
}

async function mint_key(scopes: ApiKeyScope[], key_audience: ApiKeyAudience = 'internal') {
  const { secret } = await create_api_key(db, {
    workspace_id,
    key_name: 'skills key',
    scopes,
    key_audience,
    environment_label: 'test',
    actor_id,
  });
  return secret;
}

async function get(secret: string, path: string) {
  const response = await app.request(path, { headers: { authorization: `Bearer ${secret}` } });
  return { status: response.status, body: (await response.json()) as { data: Skill[] & Skill } };
}

describe('public skills API', () => {
  beforeEach(async () => {
    db = await create_test_database();
    const bootstrap = await bootstrap_default_workspace(db);
    workspace_id = bootstrap.workspace_id;
    actor_id = bootstrap.user_id;
    app = create_app(db);
    await create_volume(db, {
      workspace_id,
      volume_provider: 'archil',
      workspace_layout_version: 2,
      volume_status: 'active',
      provider_volume_id: 'dsk_public_skills_test',
      provider_region: 'aws-us-east-1',
      actor_id,
    });
    volume_objects.index_text = procedure_index('quote-drafting', 'Draft a quote from a form.');
  });

  it('lists the platform library and the agent’s own procedures, metadata only', async () => {
    const secret = await mint_key(['skills.read']);

    const { status, body } = await get(secret, '/v1/skills');

    expect(status).toBe(200);
    const workspace_skill = body.data.find((skill) => skill.skill_id === 'quote-drafting');
    expect(workspace_skill).toEqual({
      skill_id: 'quote-drafting',
      name: 'Quote drafting',
      description: 'Draft a quote from a form.',
      source: 'workspace',
    });
    expect(body.data.some((skill) => skill.source === 'platform')).toBe(true);
    for (const skill of body.data) {
      expect(Object.keys(skill).sort()).toEqual(['description', 'name', 'skill_id', 'source']);
    }
  });

  it('lets the platform win a slug collision, like the run does', async () => {
    const secret = await mint_key(['skills.read']);
    const platform = (await get(secret, '/v1/skills')).body.data.find(
      (skill) => skill.source === 'platform',
    );
    volume_objects.index_text = procedure_index(platform?.skill_id ?? '', 'Injected text.');

    const read = await get(secret, `/v1/skills/${platform?.skill_id}`);

    expect(read.body.data.source).toBe('platform');
    expect(read.body.data.description).not.toBe('Injected text.');
  });

  it('reads one skill, and 404s an unknown skill or agent', async () => {
    const secret = await mint_key(['skills.read']);

    expect((await get(secret, '/v1/skills/quote-drafting')).body.data.source).toBe('workspace');
    expect((await get(secret, '/v1/skills/nothing-here')).status).toBe(404);
    expect((await get(secret, '/v1/skills?agent=nobody')).status).toBe(404);
  });

  it('refuses a key without skills.read, and an external key that holds it', async () => {
    expect((await get(await mint_key(['sessions.read']), '/v1/skills')).status).toBe(403);
    expect((await get(await mint_key(['skills.read'], 'external'), '/v1/skills')).status).toBe(403);
  });
});

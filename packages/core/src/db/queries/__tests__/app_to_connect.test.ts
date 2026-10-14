import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import type { Database } from '@coworker/core/db/connection';
import {
  find_app_to_connect,
  list_catalog_spellings,
} from '@coworker/core/db/queries/app_to_connect';
import { apps } from '@coworker/core/db/schema';
import { beforeEach, describe, expect, it } from 'vitest';

const actor_id = 'system:test_app_to_connect';
const workspace_id = 'ws_app_to_connect';

async function insert_app(
  db: Database,
  input: {
    app_name: string;
    display_name: string;
    provider: 'native' | 'composio';
    toolkit_slug?: string;
  },
) {
  await db.insert(apps).values({
    app_id: `app_${input.app_name}`,
    app_name: input.app_name,
    app_key: input.app_name,
    catalog_scope: 'global',
    app_display_name: input.display_name,
    app_category: 'communication',
    auth_type: 'oauth2',
    app_status: 'active',
    metadata: {
      sourced_from: {
        provider: input.provider,
        ...(input.toolkit_slug ? { provider_app_slug: input.toolkit_slug } : {}),
      },
    },
    created_by: actor_id,
    last_updated_by: actor_id,
  });
}

async function connect_to(db: Database, app_name: string) {
  const app = await find_app_to_connect(db, { workspace_id, app_name });
  return app?.app_name ?? null;
}

describe('find_app_to_connect with a Composio twin', () => {
  let db: Database;

  beforeEach(async () => {
    db = await create_test_database();
    await insert_app(db, { app_name: 'attio', display_name: 'Attio', provider: 'native' });
    await insert_app(db, {
      app_name: 'attio_v2',
      display_name: 'Attio',
      provider: 'composio',
      toolkit_slug: 'attio',
    });
    await insert_app(db, { app_name: 'slack', display_name: 'Slack', provider: 'native' });
    await insert_app(db, {
      app_name: 'composio_slack',
      display_name: 'Slack',
      provider: 'composio',
      toolkit_slug: 'slack',
    });
  });

  it('answers "attio" with the Composio app under another app name', async () => {
    expect(await connect_to(db, 'attio')).toBe('attio_v2');
  });

  it('keeps our own connector when it is a preferred native app', async () => {
    expect(await connect_to(db, 'slack')).toBe('slack');
  });
});

describe('find_app_to_connect with a name as a person says it', () => {
  let db: Database;

  beforeEach(async () => {
    db = await create_test_database();
    await insert_app(db, {
      app_name: 'composio_gmail',
      display_name: 'Gmail',
      provider: 'composio',
      toolkit_slug: 'gmail',
    });
    await insert_app(db, {
      app_name: 'composio_googleads',
      display_name: 'Google Ads',
      provider: 'composio',
      toolkit_slug: 'googleads',
    });
    await insert_app(db, { app_name: 'google_drive', display_name: 'Drive', provider: 'native' });
  });

  it('finds the hosted-catalog app when no app carries that exact name', async () => {
    expect(await connect_to(db, 'gmail')).toBe('composio_gmail');
  });

  it('reads "Google Ads" as the catalog spelling googleads', async () => {
    expect(await connect_to(db, 'Google Ads')).toBe('composio_googleads');
  });

  it('reads "Google Drive" as the app name google_drive', async () => {
    expect(await connect_to(db, 'Google Drive')).toBe('google_drive');
  });

  it('finds nothing when no spelling matches', async () => {
    expect(await connect_to(db, 'nonesuch')).toBeNull();
  });

  it('spells a name joined and with underscores', () => {
    expect(list_catalog_spellings(' Google  Ads ')).toEqual(['googleads', 'google_ads']);
    expect(list_catalog_spellings('gmail')).toEqual(['gmail']);
    expect(list_catalog_spellings('---')).toEqual([]);
  });
});

import { create_app } from '@api/app';
import { clear_model_catalog_cache } from '@api/services/models/model_catalog';
import { env } from '@coworker/config';
import {
  model_catalog_refreshes_by_default,
  model_provider_logo_base_url,
} from '@coworker/config/hosted_defaults';
import { create_test_database } from '@coworker/core/db/__tests__/test_database';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the model list on an install that set no switch', () => {
  it('comes from the bundled snapshot, with no call to the hosted list', async () => {
    expect(env.MODEL_CATALOG_REFRESH).toBeUndefined();
    expect(model_catalog_refreshes_by_default).toBe(false);
    clear_model_catalog_cache();
    Object.defineProperty(env, 'ANTHROPIC_API_KEY', { configurable: true, value: 'test_key' });
    const fetch_mock = vi.fn();
    vi.stubGlobal('fetch', fetch_mock);
    const app = create_app(await create_test_database());

    const response = await app.request('/v1/models');

    expect(response.status).toBe(200);
    expect((await response.json()).data.length).toBeGreaterThan(0);
    expect(fetch_mock).not.toHaveBeenCalled();
  });

  it('shows no provider logo from another site', () => {
    expect(model_provider_logo_base_url).toBe('');
  });
});

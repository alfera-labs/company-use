import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { beforeEach, describe, expect, it } from 'vitest';

const migration_path = resolve(
  import.meta.dirname,
  '../migrations/0043_scope_exchanged_api_headers.sql',
);

const session_headers = ['Cookie', 'X-XSRF-TOKEN'];
const api_protocol_headers = ['Accept', 'Content-Type', 'X-Vendor-API-Version', 'X-Requested-With'];

function login_rule(header_name: string) {
  return {
    when_the_request_goes_to: 'www.acmebooking.com',
    take_the_value_from: `from_the_exchange.${header_name}`,
    put_it_in_header: header_name,
    encode_the_value_as: 'as_is',
    written_as: '{value}',
    worked_out_by: 'login',
    last_confirmed_time: '2026-08-01T18:44:57.631Z',
  };
}

const broken_app_config = {
  add_to_every_request: [...session_headers, ...api_protocol_headers].map(login_rule),
  exchange_the_credential_by: {
    exchange_kind: 'api_login',
    stop_after_failed_attempts: 1,
    recipe: {
      post_credentials_to: 'https://www.acmebooking.com/api/account/signin',
      send_fields: { username: 'username', password: 'password' },
      keep_cookies_named: ['session', 'XSRF-TOKEN'],
      always_send_headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': 'application/json;charset=UTF-8',
        'X-Vendor-API-Version': '2019-06-10',
        'X-Requested-With': 'XMLHttpRequest',
      },
    },
  },
};

type AppConfig = {
  add_to_every_request: {
    put_it_in_header?: string;
    put_it_in_the_query_at?: string;
    worked_out_by: string;
  }[];
  api_protocol_headers?: Record<string, string>;
};

let client: PGlite;

async function run_the_migration() {
  const migration_sql = readFileSync(migration_path, 'utf8');
  for (const statement of migration_sql.split('--> statement-breakpoint')) {
    const trimmed_statement = statement.trim();
    if (trimmed_statement) await client.exec(trimmed_statement);
  }
}

async function read_app_config(app_id: string): Promise<AppConfig> {
  const result = await client.query<{ app_config: AppConfig }>(
    'SELECT app_config FROM apps WHERE app_id = $1',
    [app_id],
  );
  return result.rows[0]?.app_config as AppConfig;
}

async function insert_app(app_id: string, app_config: unknown) {
  await client.query('INSERT INTO apps (app_id, app_config) VALUES ($1, $2)', [
    app_id,
    JSON.stringify(app_config),
  ]);
}

beforeEach(async () => {
  client = new PGlite();
  await client.exec(`
    CREATE TABLE apps (
      app_id text PRIMARY KEY,
      app_config jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `);
});

describe('scoping exchanged API headers out of the egress rules', () => {
  it('leaves only the session headers as delivery rules', async () => {
    await insert_app('app_acme', broken_app_config);
    await run_the_migration();

    const config = await read_app_config('app_acme');
    expect(config.add_to_every_request.map((rule) => rule.put_it_in_header).sort()).toEqual(
      session_headers,
    );
  });

  it('records the protocol headers, with their values, where a caller can read them', async () => {
    await insert_app('app_acme', broken_app_config);
    await run_the_migration();

    expect((await read_app_config('app_acme')).api_protocol_headers).toEqual({
      Accept: 'application/json, text/plain, */*',
      'Content-Type': 'application/json;charset=UTF-8',
      'X-Vendor-API-Version': '2019-06-10',
      'X-Requested-With': 'XMLHttpRequest',
    });
  });

  it('runs twice with the same result', async () => {
    await insert_app('app_acme', broken_app_config);
    await run_the_migration();
    const after_once = await read_app_config('app_acme');
    await run_the_migration();

    expect(await read_app_config('app_acme')).toEqual(after_once);
  });

  it('does not touch a rule a person wrote by hand', async () => {
    await insert_app('app_handwritten', {
      add_to_every_request: [{ ...login_rule('Accept'), worked_out_by: 'human_override' }],
    });
    await run_the_migration();

    const config = await read_app_config('app_handwritten');
    expect(config.add_to_every_request).toHaveLength(1);
    expect(config.add_to_every_request[0]?.put_it_in_header).toBe('Accept');
  });

  it('leaves an app with no delivery rules alone', async () => {
    await insert_app('app_empty', { add_to_every_request: [] });
    await run_the_migration();

    expect(await read_app_config('app_empty')).toEqual({ add_to_every_request: [] });
  });

  it('leaves an app with no credential config at all alone', async () => {
    await insert_app('app_bare', {});
    await run_the_migration();

    expect(await read_app_config('app_bare')).toEqual({});
  });

  it('scopes a protocol header this vendor named itself', async () => {
    await insert_app('app_other_vendor', {
      add_to_every_request: [login_rule('Cookie'), login_rule('X-Client-Version')],
      exchange_the_credential_by: {
        exchange_kind: 'api_login',
        recipe: { always_send_headers: { 'X-Client-Version': '7' } },
      },
    });
    await run_the_migration();

    const config = await read_app_config('app_other_vendor');
    expect(config.add_to_every_request.map((rule) => rule.put_it_in_header)).toEqual(['Cookie']);
    expect(config.api_protocol_headers).toEqual({ 'X-Client-Version': '7' });
  });

  it('never removes a rule whose value it could not record', async () => {
    await insert_app('app_no_recipe_headers', {
      add_to_every_request: [login_rule('Cookie'), login_rule('Accept')],
      exchange_the_credential_by: {
        exchange_kind: 'api_login',
        recipe: { post_credentials_to: 'https://example.invalid/signin' },
      },
    });
    await run_the_migration();

    expect(
      (await read_app_config('app_no_recipe_headers')).add_to_every_request.map(
        (rule) => rule.put_it_in_header,
      ),
    ).toEqual(['Cookie', 'Accept']);
  });

  // A rule may place its value in a query parameter or the body instead of a
  // header. `rule->>'put_it_in_header'` is NULL for those, and under SQL
  // three-valued logic `NOT (true AND NULL)` is NULL, so jsonb_agg silently
  // dropped an unrelated OAuth rule this migration never meant to touch.
  it('keeps a rule that puts its value somewhere other than a header', async () => {
    await insert_app('app_query_rule', {
      add_to_every_request: [
        {
          when_the_request_goes_to: 'www.acmebooking.com',
          take_the_value_from: 'from_the_exchange.token',
          put_it_in_the_query_at: 'access_token',
          encode_the_value_as: 'as_is',
          written_as: '{value}',
          worked_out_by: 'oauth',
        },
        login_rule('Accept'),
      ],
      exchange_the_credential_by: {
        exchange_kind: 'api_login',
        recipe: { always_send_headers: { Accept: 'application/json' } },
      },
    });
    await run_the_migration();

    const config = await read_app_config('app_query_rule');
    expect(config.add_to_every_request).toHaveLength(1);
    expect(config.add_to_every_request[0]?.put_it_in_the_query_at).toBe('access_token');
  });

  it('does not publish a credential-shaped header, and leaves it delivered', async () => {
    await insert_app('app_bearer', {
      add_to_every_request: [login_rule('Authorization'), login_rule('Accept')],
      exchange_the_credential_by: {
        exchange_kind: 'api_login',
        recipe: {
          always_send_headers: {
            Authorization: 'Basic c2VjcmV0',
            Accept: 'application/json',
          },
        },
      },
    });
    await run_the_migration();

    const config = await read_app_config('app_bearer');
    expect(config.api_protocol_headers).toEqual({ Accept: 'application/json' });
    expect(JSON.stringify(config.api_protocol_headers)).not.toContain('c2VjcmV0');
    expect(config.add_to_every_request.map((rule) => rule.put_it_in_header)).toEqual([
      'Authorization',
    ]);
  });

  it('leaves an empty array, not null, when every rule was a protocol header', async () => {
    await insert_app('app_all_protocol', {
      add_to_every_request: api_protocol_headers.map(login_rule),
      exchange_the_credential_by: broken_app_config.exchange_the_credential_by,
    });
    await run_the_migration();

    expect((await read_app_config('app_all_protocol')).add_to_every_request).toEqual([]);
  });
});

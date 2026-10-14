import { env } from '@coworker/config';
import type { ComposioToolkitDetail } from '@coworker/core/integrations/composio_api_records';
import {
  composio_api_base_url,
  composio_auth_config_schema,
  composio_connect_link_schema,
  composio_connected_account_schema,
  composio_created_auth_config_schema,
  composio_execute_result_schema,
  composio_file_upload_request_schema,
  composio_page_schema,
  composio_proxy_result_schema,
  composio_tool_schema,
  composio_toolkit_detail_schema,
  composio_toolkit_summary_schema,
  composio_trigger_instance_schema,
  composio_trigger_type_schema,
} from '@coworker/core/integrations/composio_api_records';
import {
  as_error,
  ComposioApiError,
  type ComposioRequestInit,
  type ComposioRetryNotice,
  merge_abort_signals,
  send_request_with_retries,
} from '@runtime-platform/composio/composio_request';
import {
  composio_retry_maximum_attempts,
  repeats_are_safe_for_http_method,
} from '@runtime-platform/composio/composio_request_retry';
import { z } from 'zod';

export type ComposioClient = ReturnType<typeof create_composio_client>;

type ComposioToolkitDetailResult =
  | { toolkit_slug: string; toolkit: ComposioToolkitDetail; error: null }
  | { toolkit_slug: string; toolkit: null; error: Error };

export function composio_is_configured() {
  return Boolean(env.COMPOSIO_API_KEY);
}

// `/toolkits` and `/tools` allow 1000 per page; `/triggers_types` and `/auth_configs` cap at 50.
const max_page_size = 1000;
const small_page_size = 50;

const max_pages = 200;

export { ComposioApiError, type ComposioRetryNotice, composio_retry_maximum_attempts };

const default_page_concurrency = 8;
const default_toolkit_detail_concurrency = 12;

const per_toolkit_filter_maximum = 20;

type ComposioRequest = (path: string, init?: ComposioRequestInit) => Promise<unknown>;

type ComposioPageQuery = NonNullable<ComposioRequestInit['query']>;

type ComposioListAllPages = <T extends z.ZodTypeAny>(
  path: string,
  input: { item: T; limit: number; query?: ComposioPageQuery },
) => Promise<Array<z.infer<T>>>;

type ComposioListAllPagesInParallel = <T extends z.ZodTypeAny>(
  path: string,
  input: {
    item: T;
    limit: number;
    query?: ComposioPageQuery;
    page_concurrency?: number | undefined;
  },
) => Promise<Array<z.infer<T>>>;

export function create_composio_client(config: {
  api_key: string;
  base_url?: string | undefined;
  fetch?: typeof fetch | undefined;
  on_retry?: ((notice: ComposioRetryNotice) => void) | undefined;
}) {
  const base_url = (config.base_url ?? composio_api_base_url).replace(/\/+$/u, '');
  const run_fetch: typeof fetch = (url, init) => (config.fetch ?? globalThis.fetch)(url, init);

  const request: ComposioRequest = (path, init = {}) =>
    send_request_with_retries({ run_fetch, base_url, path, init, config });

  const list_all_pages: ComposioListAllPages = async (path, input) => {
    const page_schema = composio_page_schema(input.item);
    const items: Array<z.infer<typeof input.item>> = [];
    let cursor: string | undefined;

    for (let page_index = 0; page_index < max_pages; page_index += 1) {
      const page = page_schema.parse(
        await request(path, {
          query: { limit: input.limit, ...(input.query ?? {}), ...(cursor ? { cursor } : {}) },
        }),
      );
      items.push(...page.items);
      const next_cursor = page.next_cursor?.trim();
      if (!next_cursor || next_cursor === cursor) return items;
      cursor = next_cursor;
    }

    throw new Error(`Composio paging for ${path} exceeded ${max_pages} pages.`);
  };

  const list_all_pages_in_parallel: ComposioListAllPagesInParallel = async (path, input) => {
    const page_schema = composio_page_schema(input.item);
    const query = { limit: String(input.limit), ...(input.query ?? {}) };
    const first_page = page_schema.parse(await request(path, { query }));
    const total_pages = first_page.total_pages ?? 1;
    if (total_pages <= 1) return first_page.items;
    if (total_pages > max_pages) {
      throw new Error(`Composio paging for ${path} exceeded ${max_pages} pages.`);
    }

    const later_pages = await read_constructed_cursor_pages({
      request,
      path,
      query,
      limit: input.limit,
      page_schema,
      total_pages,
      page_concurrency: input.page_concurrency ?? default_page_concurrency,
    });
    if (!later_pages) return list_all_pages(path, input);
    return [...first_page.items, ...later_pages.flat()];
  };

  return {
    ...build_catalog_reads(request, list_all_pages, list_all_pages_in_parallel),
    ...build_connected_account_methods(request, list_all_pages),
    ...build_execution_methods(request, run_fetch),
    ...build_trigger_methods(request, list_all_pages),
  };
}

function build_catalog_reads(
  request: ComposioRequest,
  list_all_pages: ComposioListAllPages,
  list_all_pages_in_parallel: ComposioListAllPagesInParallel,
) {
  function list_toolkits(input?: { category?: string | undefined }) {
    return list_all_pages('/toolkits', {
      item: composio_toolkit_summary_schema,
      limit: max_page_size,
      ...(input?.category ? { query: { category: input.category } } : {}),
    });
  }

  async function get_toolkit(slug: string) {
    return composio_toolkit_detail_schema.parse(await request(`/toolkits/${encode(slug)}`));
  }

  function list_tools(input: { toolkit_slug: string }) {
    return list_all_pages('/tools', {
      item: composio_tool_schema,
      limit: max_page_size,
      query: { toolkit_slug: input.toolkit_slug, toolkit_versions: 'latest' },
    });
  }

  function list_trigger_types(input: { toolkit_slug: string }) {
    return list_all_pages('/triggers_types', {
      item: composio_trigger_type_schema,
      limit: small_page_size,
      query: { toolkit_slugs: input.toolkit_slug },
    });
  }

  async function list_all_tools(input?: {
    toolkit_slugs?: string[] | undefined;
    page_concurrency?: number | undefined;
  }) {
    const toolkit_slugs = input?.toolkit_slugs ?? [];
    if (use_per_toolkit_filter(toolkit_slugs)) {
      return collect_per_toolkit(toolkit_slugs, input?.page_concurrency, (toolkit_slug) =>
        list_tools({ toolkit_slug }),
      );
    }
    return unique_by_slug(
      await list_all_pages_in_parallel('/tools', {
        item: composio_tool_schema,
        limit: max_page_size,
        query: { toolkit_versions: 'latest' },
        ...(input?.page_concurrency === undefined
          ? {}
          : { page_concurrency: input.page_concurrency }),
      }),
    );
  }

  async function list_all_trigger_types(input?: {
    toolkit_slugs?: string[] | undefined;
    page_concurrency?: number | undefined;
  }) {
    const toolkit_slugs = input?.toolkit_slugs ?? [];
    if (use_per_toolkit_filter(toolkit_slugs)) {
      return collect_per_toolkit(toolkit_slugs, input?.page_concurrency, (toolkit_slug) =>
        list_trigger_types({ toolkit_slug }),
      );
    }
    return unique_by_slug(
      await list_all_pages_in_parallel('/triggers_types', {
        item: composio_trigger_type_schema,
        limit: small_page_size,
        ...(input?.page_concurrency === undefined
          ? {}
          : { page_concurrency: input.page_concurrency }),
      }),
    );
  }

  // `auth_config_details` and `base_url` live only on the detail endpoint, so a catalog sync needs
  // one call per toolkit. They run as a bounded fan-out, and each toolkit carries its own failure.
  async function get_toolkits_detail(
    toolkit_slugs: string[],
    options?: { concurrency?: number | undefined },
  ): Promise<ComposioToolkitDetailResult[]> {
    const results = new Map<string, ComposioToolkitDetailResult>();
    await run_with_concurrency(
      toolkit_slugs,
      options?.concurrency ?? default_toolkit_detail_concurrency,
      async (toolkit_slug) => {
        try {
          results.set(toolkit_slug, {
            toolkit_slug,
            toolkit: await get_toolkit(toolkit_slug),
            error: null,
          });
        } catch (error) {
          results.set(toolkit_slug, { toolkit_slug, toolkit: null, error: as_error(error) });
        }
      },
    );
    return toolkit_slugs.flatMap((toolkit_slug) => {
      const result = results.get(toolkit_slug);
      return result ? [result] : [];
    });
  }

  return {
    list_toolkits,
    get_toolkit,
    list_tools,
    list_trigger_types,
    list_all_tools,
    list_all_trigger_types,
    get_toolkits_detail,
  };
}

function use_per_toolkit_filter(toolkit_slugs: string[]) {
  return toolkit_slugs.length > 0 && toolkit_slugs.length <= per_toolkit_filter_maximum;
}

// An unfiltered list hands the same record back twice when a toolkit straddles a page boundary:
// `/tools` answers the 19 tools of the `composio` toolkit as 35 rows. A catalog is a set, so the
// first copy of each slug wins and the rest are dropped.
function unique_by_slug<T extends { slug: string }>(items: T[]) {
  const item_by_slug = new Map<string, T>();
  for (const item of items) {
    if (!item_by_slug.has(item.slug)) item_by_slug.set(item.slug, item);
  }
  return [...item_by_slug.values()];
}

async function collect_per_toolkit<T>(
  toolkit_slugs: string[],
  concurrency: number | undefined,
  read: (toolkit_slug: string) => Promise<T[]>,
) {
  const items_by_slug = new Map<string, T[]>();
  await run_with_concurrency(
    toolkit_slugs,
    concurrency ?? default_page_concurrency,
    async (toolkit_slug) => {
      items_by_slug.set(toolkit_slug, await read(toolkit_slug));
    },
  );
  return toolkit_slugs.flatMap((toolkit_slug) => items_by_slug.get(toolkit_slug) ?? []);
}

function build_connected_account_methods(
  request: ComposioRequest,
  list_all_pages: ComposioListAllPages,
) {
  return {
    list_auth_configs(input: { toolkit_slug: string; show_disabled?: boolean | undefined }) {
      return list_all_pages('/auth_configs', {
        item: composio_auth_config_schema,
        limit: small_page_size,
        query: {
          toolkit_slug: input.toolkit_slug,
          show_disabled: String(input.show_disabled ?? false),
        },
      });
    },

    async create_auth_config(body: {
      toolkit: { slug: string };
      auth_config:
        | { type: 'use_composio_managed_auth'; name?: string }
        | {
            type: 'use_custom_auth';
            authScheme: string;
            name?: string;
            credentials: Record<string, unknown>;
          };
    }) {
      return composio_created_auth_config_schema.parse(
        await request('/auth_configs', { method: 'POST', body }),
      );
    },

    async create_connect_link(body: {
      auth_config_id: string;
      user_id: string;
      callback_url?: string | undefined;
      alias?: string | undefined;
    }) {
      return composio_connect_link_schema.parse(
        await request('/connected_accounts/link', { method: 'POST', body }),
      );
    },

    async get_connected_account(connected_account_id: string) {
      return composio_connected_account_schema.parse(
        await request(`/connected_accounts/${encode(connected_account_id)}`),
      );
    },

    async delete_connected_account(
      connected_account_id: string,
      input?: { revoke_on_delete?: boolean | undefined },
    ) {
      return delete_result_schema.parse(
        await request(`/connected_accounts/${encode(connected_account_id)}`, {
          method: 'DELETE',
          query: { revoke_on_delete: input?.revoke_on_delete ?? true },
        }),
      );
    },
  };
}

function build_execution_methods(request: ComposioRequest, run_fetch: typeof fetch) {
  return {
    // HTTP 200 even when the tool failed: `successful: false` carries the provider's own error.
    async execute_tool(
      tool_slug: string,
      body: {
        connected_account_id?: string | undefined;
        user_id?: string | undefined;
        arguments: Record<string, unknown>;
        version?: string | undefined;
      },
      options?: { signal?: AbortSignal | undefined; repeat_when_unsure?: boolean },
    ) {
      return composio_execute_result_schema.parse(
        await request(`/tools/execute/${encode(tool_slug)}`, {
          method: 'POST',
          body,
          repeat_when_unsure: options?.repeat_when_unsure ?? false,
          ...(options?.signal ? { signal: options.signal } : {}),
        }),
      );
    },

    async proxy_execute(
      body: {
        connected_account_id: string;
        endpoint: string;
        method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
        body?: unknown;
        parameters?: Array<{ name: string; value: string; type: 'header' | 'query' }>;
      },
      options?: { signal?: AbortSignal | undefined },
    ) {
      return composio_proxy_result_schema.parse(
        await request('/tools/execute/proxy', {
          method: 'POST',
          body,
          repeat_when_unsure: repeats_are_safe_for_http_method(body.method),
          ...(options?.signal ? { signal: options.signal } : {}),
        }),
      );
    },

    async create_file_upload(body: {
      toolkit_slug: string;
      tool_slug: string;
      filename: string;
      mimetype: string;
      md5: string;
    }) {
      return composio_file_upload_request_schema.parse(
        await request('/files/upload/request', { method: 'POST', body }),
      );
    },

    // The presigned URL is S3's, not Composio's: no api key, no JSON envelope, and a failure is
    // an S3 XML body rather than the `{ error: ... }` shape.
    async upload_file_bytes(presigned_url: string, bytes: Uint8Array, mimetype: string) {
      const response = await run_fetch(presigned_url, {
        method: 'PUT',
        headers: { 'content-type': mimetype },
        body: new Uint8Array(bytes),
        signal: merge_abort_signals(undefined),
      });
      if (!response.ok) {
        throw new ComposioApiError({
          message: `Composio file upload failed with status ${response.status}.`,
          status: response.status,
        });
      }
    },
  };
}

function build_trigger_methods(request: ComposioRequest, list_all_pages: ComposioListAllPages) {
  return {
    async upsert_trigger_instance(
      trigger_slug: string,
      body: {
        connected_account_id: string;
        trigger_config?: Record<string, unknown> | undefined;
        toolkit_versions?: string | undefined;
      },
    ) {
      return trigger_upsert_result_schema.parse(
        await request(`/trigger_instances/${encode(trigger_slug)}/upsert`, {
          method: 'POST',
          body: { toolkit_versions: 'latest', ...body },
        }),
      );
    },

    async set_trigger_instance_status(trigger_id: string, status: 'enable' | 'disable') {
      return trigger_status_result_schema.parse(
        await request(`/trigger_instances/manage/${encode(trigger_id)}`, {
          method: 'PATCH',
          body: { status },
        }),
      );
    },

    async delete_trigger_instance(trigger_id: string) {
      return delete_result_schema.parse(
        await request(`/trigger_instances/manage/${encode(trigger_id)}`, { method: 'DELETE' }),
      );
    },

    async list_active_trigger_instances(input: {
      connected_account_ids?: string[] | undefined;
      show_disabled?: boolean | undefined;
    }) {
      return list_all_pages('/trigger_instances/active', {
        item: composio_trigger_instance_schema,
        limit: small_page_size,
        query: {
          ...(input.connected_account_ids
            ? { connected_account_ids: input.connected_account_ids }
            : {}),
          ...(input.show_disabled === undefined ? {} : { show_disabled: input.show_disabled }),
        },
      });
    },
  };
}

const delete_result_schema = z.object({ success: z.boolean().optional() }).passthrough();
const trigger_upsert_result_schema = z.object({ trigger_id: z.string() }).passthrough();
const trigger_status_result_schema = z.record(z.string(), z.unknown());

let composio_client: ComposioClient | null = null;

export function get_composio_client(): ComposioClient {
  if (composio_client) return composio_client;

  const api_key = env.COMPOSIO_API_KEY;
  if (!api_key) throw new Error('Composio client requested without COMPOSIO_API_KEY.');

  composio_client = create_composio_client({ api_key });
  return composio_client;
}

export function reset_composio_client_for_tests() {
  composio_client = null;
}

// The cursor Composio reads is base64 of `${page}-${limit}`, so page N can be asked for without
// having read page N-1.
function build_page_cursor(page_number: number, limit: number) {
  return Buffer.from(`${page_number}-${limit}`, 'utf8').toString('base64');
}

async function read_constructed_cursor_pages<T extends z.ZodTypeAny>(input: {
  request: ComposioRequest;
  path: string;
  query: ComposioPageQuery;
  limit: number;
  page_schema: z.ZodType<{ items: Array<z.infer<T>> }>;
  total_pages: number;
  page_concurrency: number;
}): Promise<Array<Array<z.infer<T>>> | null> {
  const page_numbers = Array.from({ length: input.total_pages - 1 }, (_, index) => index + 2);
  const items_by_page = new Map<number, Array<z.infer<T>>>();
  let cursor_failed = false;

  await run_with_concurrency(page_numbers, input.page_concurrency, async (page_number) => {
    if (cursor_failed) return;
    try {
      const page = input.page_schema.parse(
        await input.request(input.path, {
          query: { ...input.query, cursor: build_page_cursor(page_number, input.limit) },
        }),
      );
      items_by_page.set(page_number, page.items);
    } catch {
      cursor_failed = true;
    }
  });

  if (cursor_failed) return null;
  return page_numbers.map((page_number) => items_by_page.get(page_number) ?? []);
}

async function run_with_concurrency<T>(items: T[], limit: number, run: (item: T) => Promise<void>) {
  let next_index = 0;
  async function worker() {
    while (next_index < items.length) {
      const index = next_index;
      next_index += 1;
      await run(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker));
}

function encode(segment: string) {
  return encodeURIComponent(segment);
}

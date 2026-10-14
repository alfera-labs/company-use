import { z } from 'zod';
import { read_tool_detail_output } from '@/components/prompt-kit/tool_detail_payload';

const search_result_schema = z.object({
  title: z.string().trim().min(1),
  url: z.string().trim().min(1),
});

const search_output_schema = z.object({
  provider: z.string().trim(),
  query: z.string().trim().optional(),
  results: z.array(z.unknown()),
});

export type WebSearchResult = {
  domain: string;
  favicon_url: string;
  title: string;
  url: string;
};

type WebSearchView = {
  output_is_readable: boolean;
  provider_unavailable: boolean;
  query: string;
  results: WebSearchResult[];
};

export type WebSearchCallView = WebSearchView & {
  call_id: string;
  issue: WebSearchIssue | null;
  state: string;
};

export type WebSearchIssue = 'denied' | 'failed' | 'stopped' | 'unavailable' | 'unreadable';

type WebSearchGroupView = {
  calls: WebSearchCallView[];
  issue_count: number;
  results: WebSearchResult[];
};

function read_web_search_view(input: unknown, output: unknown, output_text?: string) {
  const query = read_query(input);
  const parsed_output = read_search_output(output, output_text);
  if (!parsed_output.success) {
    return { query, output_is_readable: false, provider_unavailable: false, results: [] };
  }

  const results = parsed_output.data.results.flatMap(read_result);
  return {
    query: parsed_output.data.query || query,
    output_is_readable: true,
    provider_unavailable: parsed_output.data.provider === 'none',
    results: [...new Map(results.map((result) => [result.url, result])).values()],
  } satisfies WebSearchView;
}

export function read_web_search_group(
  calls: {
    call_id: string;
    input?: unknown;
    output?: unknown;
    outputText?: string;
    errorText?: string;
    state: string;
  }[],
) {
  const views = calls.map((call) => {
    const view = read_web_search_view(call.input, call.output, call.outputText);
    return {
      ...view,
      call_id: call.call_id,
      issue: web_search_issue(call, view),
      state: call.state,
    };
  });
  const results = views.flatMap((view) => view.results);
  return {
    calls: views,
    issue_count: views.filter((view) => view.issue).length,
    results: [...new Map(results.map((result) => [result.url, result])).values()],
  } satisfies WebSearchGroupView;
}

const stopped_states = new Set(['attempted', 'blocked', 'cancelled']);
const failed_states = new Set(['error', 'failed', 'timed_out']);
const running_settled_states = new Set([
  'attempted',
  'awaiting_approval',
  'blocked',
  'cancelled',
  'complete',
  'completed',
  'denied',
  'done',
  'error',
  'failed',
  'success',
  'succeeded',
  'timed_out',
]);

function web_search_issue(
  call: { errorText?: string; state: string },
  view: WebSearchView,
): WebSearchIssue | null {
  if (call.state === 'denied') return 'denied';
  if (stopped_states.has(call.state)) return 'stopped';
  if (call.errorText || failed_states.has(call.state)) return 'failed';
  if (view.provider_unavailable) return 'unavailable';
  if (is_running_state(call.state) || call.state === 'awaiting_approval') return null;
  return view.output_is_readable ? null : 'unreadable';
}

export function is_running_state(state: string) {
  return !running_settled_states.has(state);
}

function read_search_output(output: unknown, output_text: string | undefined) {
  const structured = search_output_schema.safeParse(read_tool_detail_output(output));
  if (structured.success) return structured;
  return search_output_schema.safeParse(read_tool_detail_output(parse_output_text(output_text)));
}

function read_query(input: unknown) {
  const parsed = z.object({ query: z.string().trim() }).safeParse(input);
  return parsed.success ? parsed.data.query : '';
}

function parse_output_text(output_text: string | undefined) {
  if (!output_text?.trim()) return undefined;
  try {
    return JSON.parse(output_text) as unknown;
  } catch {
    return undefined;
  }
}

function read_result(value: unknown): WebSearchResult[] {
  const parsed = search_result_schema.safeParse(value);
  if (!parsed.success) return [];

  const url = read_public_url(parsed.data.url);
  if (!url) return [];
  return [
    {
      domain: url.hostname.replace(/^www\./iu, ''),
      favicon_url: `${url.origin}/favicon.ico`,
      title: parsed.data.title,
      url: url.toString(),
    },
  ];
}

function read_public_url(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

import type { SessionEnv } from '@agent-core/environment/session_env';
import { create_logger, format_error_message } from '@coworker/shared';
import {
  parse_skill_file,
  parse_skill_sidecar,
  skill_file_name,
  skill_sidecar_file_name,
} from '@runtime-platform/skills/skill_file';
import { procedures_folder } from '@runtime-platform/storage/workspace_layouts';
import type { RuntimeToolExecutionContext } from '@runtime-platform/tools/types';

// Loading a workspace procedure: the body, plus the schemas of the tools it names.
//
// The preloaded schemas are the point. Discovery costs a turn to search the catalog and
// another to fetch a schema, and a procedure already knows which tools it needs. Without them a
// session spends dozens of turns on searches and schema fetches for tools its own workflow doc
// names in plain English.
//
// They ride in this TOOL RESULT, never in the request's `tools` block. That block is the first
// thing in Anthropic's cache prefix, so a tool set that changes mid-run rewrites the cache for
// everything behind it (see pi_deferred_tools.ts). A result rides in `messages`, behind the
// prefix, and costs the cache nothing.

const log = create_logger('load_workspace_procedure');

const maximum_listed_resources = 60;
const maximum_resource_depth = 3;

type PreloadedTool = {
  node_key: string;
  description: string;
  input_schema: unknown;
};

export type LoadedWorkspaceProcedure = {
  skill_slug: string;
  skill_name: string;
  content: string;
  preloaded_tools: PreloadedTool[];
  resources: string[];
};

export async function load_workspace_procedure(
  skill_slug: string,
  context: RuntimeToolExecutionContext,
): Promise<LoadedWorkspaceProcedure | undefined> {
  const environment = context.environment;
  if (!environment?.read) return undefined;
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(skill_slug)) return undefined;

  const folder = `${procedures_folder}/${skill_slug}`;
  const file_text = await environment.read(`${folder}/${skill_file_name}`).catch(() => undefined);
  if (file_text === undefined) return undefined;

  const sidecar_text = await environment
    .read(`${folder}/${skill_sidecar_file_name}`)
    .catch(() => undefined);

  try {
    const parsed = parse_skill_file(file_text);
    const sidecar = parse_skill_sidecar(sidecar_text);
    return {
      skill_slug,
      skill_name: parsed.skill_name,
      content: parsed.body,
      preloaded_tools: await collect_preloaded_tools(
        skill_slug,
        sidecar.preloaded_tool_keys,
        context.allowed_tool_names,
      ),
      resources: await list_skill_resources(environment, folder),
    };
  } catch (error) {
    log.warn('A workspace procedure could not be parsed.', {
      skill_slug,
      error: format_error_message(error),
    });
    return undefined;
  }
}

async function list_skill_resources(environment: SessionEnv, folder: string) {
  const found: string[] = [];
  await collect_paths_under(environment, folder, folder, found, 0);
  return found
    .filter((entry) => entry !== skill_file_name && entry !== skill_sidecar_file_name)
    .sort()
    .slice(0, maximum_listed_resources);
}

async function collect_paths_under(
  environment: SessionEnv,
  root: string,
  folder: string,
  found: string[],
  depth: number,
) {
  if (depth > maximum_resource_depth || found.length >= maximum_listed_resources) return;
  const listed = await environment.list?.({ path: folder }).catch(() => undefined);
  for (const name of read_listed_names(listed)) {
    const child = `${folder}/${name}`;
    if (name.includes('.')) {
      found.push(child.slice(root.length + 1));
      continue;
    }
    await collect_paths_under(environment, root, child, found, depth + 1);
  }
}

function read_listed_names(listed: unknown): string[] {
  if (Array.isArray(listed)) {
    return listed.flatMap((item) =>
      typeof item === 'string'
        ? [item]
        : typeof item === 'object' && item !== null && 'name' in item
          ? [String((item as { name: unknown }).name)]
          : [],
    );
  }
  if (typeof listed === 'object' && listed !== null && 'entries' in listed) {
    return read_listed_names((listed as { entries: unknown }).entries);
  }
  return [];
}

async function collect_preloaded_tools(
  skill_slug: string,
  node_keys: readonly string[],
  allowed_tool_names: readonly string[] | undefined,
) {
  if (node_keys.length === 0) return [];
  const { find_tool_by_node_key } = await import('@runtime-platform/tools/tool_registry');
  const preloaded: PreloadedTool[] = [];
  const unknown_keys: string[] = [];
  for (const node_key of node_keys) {
    if (allowed_tool_names && !allowed_tool_names.includes(node_key)) {
      unknown_keys.push(node_key);
      continue;
    }
    const tool = find_tool_by_node_key(node_key);
    if (!tool) {
      unknown_keys.push(node_key);
      continue;
    }
    preloaded.push({
      node_key: tool.node_key,
      description: tool.description,
      input_schema: tool.input_schema,
    });
  }
  if (unknown_keys.length > 0) {
    log.debug('A procedure named tools this deploy does not have.', { skill_slug, unknown_keys });
  }
  return preloaded;
}

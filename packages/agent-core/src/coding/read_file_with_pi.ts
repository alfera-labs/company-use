import type { ModelRootName } from '@agent-core/environment/memory_root_path';
import { model_root_of } from '@agent-core/environment/memory_root_path';
import type { SessionEnv } from '@agent-core/environment/session_env';
import { sniff_image_mime_type } from '@agent-core/images/image_header';
import { resize_image_parts_for_model } from '@agent-core/images/resize_image_parts';
import type { RuntimeToolContentPart } from '@agent-core/tools/runtime_tool_result';
import { createReadTool, type ReadOperations } from '@earendil-works/pi-coding-agent';

export async function read_file_with_pi(
  environment: SessionEnv,
  input: { workspace_path: string; offset?: number; limit?: number; tool_call_id: string },
): Promise<RuntimeToolContentPart[]> {
  // Pi resolves the model's path against the cwd the tool was built with, so a cwd of '/' turns
  // every path it produces into a workspace path with a leading slash. Stripping that slash in the
  // operations below is the whole translation.
  //
  // Pi's own resizer is off so that one function shrinks every image in this codebase against one
  // budget. Pi's read tool caps pixels but takes its byte budget from a default this call cannot
  // reach, and a picture's byte size is what a conversation dies of.
  const read_file = createReadTool('/', {
    autoResizeImages: false,
    operations: create_sandbox_read_operations(environment),
  });

  const result = await read_file.execute(input.tool_call_id, {
    path: input.workspace_path,
    ...(input.offset === undefined ? {} : { offset: input.offset }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
  });

  return await resize_image_parts_for_model(
    result.content.map((part) =>
      part.type === 'image'
        ? { type: 'image', data: part.data, mime_type: part.mimeType }
        : { type: 'text', text: part.text },
    ),
  );
}

function create_sandbox_read_operations(environment: SessionEnv): ReadOperations {
  // Pi asks whether a file is an image and then reads it, so a naive adapter fetches every file
  // from the sandbox twice. One entry is enough: a single call reads a single path.
  const read_once = create_single_path_byte_cache(environment);

  return {
    readFile: async (absolute_path) => Buffer.from(await read_once(absolute_path)),
    access: async (absolute_path) => {
      if (!environment.stat) return;
      const workspace_path = to_workspace_path(absolute_path);
      if (!(await environment.stat(workspace_path))) {
        throw new Error(`No such file: ${workspace_path}`);
      }
    },
    detectImageMimeType: environment.read_bytes
      ? async (absolute_path) => sniff_image_mime_type(await read_once(absolute_path)) ?? null
      : async () => null,
  };
}

function create_single_path_byte_cache(environment: SessionEnv) {
  let cached: { path: string; bytes: Uint8Array } | undefined;

  return async (absolute_path: string): Promise<Uint8Array> => {
    const workspace_path = to_workspace_path(absolute_path);
    if (cached?.path === workspace_path) return cached.bytes;

    const bytes = environment.read_bytes
      ? await environment.read_bytes(workspace_path)
      : new TextEncoder().encode((await environment.read?.(workspace_path)) ?? '');
    cached = { path: workspace_path, bytes };
    return bytes;
  };
}

const to_workspace_path_by_root = {
  memory: (absolute_path: string) => absolute_path,
  workspace: (absolute_path: string) => absolute_path.replace(/^\/+/, ''),
} satisfies Record<ModelRootName, (absolute_path: string) => string>;

function to_workspace_path(absolute_path: string) {
  return to_workspace_path_by_root[model_root_of(absolute_path).name](absolute_path);
}

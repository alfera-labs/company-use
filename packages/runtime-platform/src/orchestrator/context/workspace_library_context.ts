import { env } from '@coworker/config';
import type { MemoryRunSource } from '@runtime-platform/memory_host/memory_run';
import { build_docker_sandbox_protocol } from '@runtime-platform/orchestrator/context/docker_sandbox_protocol';
import {
  build_not_set_up_protocol,
  list_services_not_set_up,
  type ServiceNotSetUp,
} from '@runtime-platform/orchestrator/context/not_set_up_protocol';

export const document_library_tools = ['workspace-write_file'] as const;

export type SessionWorkspaceLibraryContext = {
  document_count: number;
  services_not_set_up: readonly ServiceNotSetUp[];
  sandbox_provider?: 'local' | 'docker' | 'e2b';
};

export async function get_workspace_library_context(
  _run: MemoryRunSource,
): Promise<SessionWorkspaceLibraryContext | undefined> {
  return {
    document_count: 0,
    services_not_set_up: list_services_not_set_up(),
    sandbox_provider: env.COWORKER_WORKSPACE_RUNTIME_PROVIDER,
  };
}

const what_to_remember_protocol = [
  '## What To Remember',
  'This workspace has no separate company memory: its files are the memory.',
  'When a person asks you to remember something, for themselves or for the company, save it with a tool call in this run. A fact goes on a page of this workspace, in the folder where it belongs. A standing rule goes in a skill. Then tell them the path of the file that holds it.',
  'Never reply that something is noted or saved unless a tool call in this run wrote it.',
  'Before you say you do not know something about this company or this person, search the workspace files.',
].join('\n');

export function build_workspace_library_protocol(library: SessionWorkspaceLibraryContext) {
  return [
    what_to_remember_protocol,
    build_not_set_up_protocol(library.services_not_set_up),
    library.sandbox_provider === 'docker' ? build_docker_sandbox_protocol() : null,
  ]
    .filter((protocol) => protocol !== null)
    .join('\n\n');
}

export function format_workspace_library_sync_message(_library?: SessionWorkspaceLibraryContext) {
  return null;
}

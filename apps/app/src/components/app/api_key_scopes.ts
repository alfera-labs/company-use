import { keep_offered_scopes } from '@coworker/shared';
import type { ApiKeyAudience, ApiKeyScope } from '@/lib/api/types';

export const api_key_scope_descriptions: Record<ApiKeyScope, string> = {
  'answers.write': 'Ask the worker for grounded answers',
  'memory.read': 'Search memory and fetch context packets',
  'memory.write': 'Teach the brain new facts',
  'agents.read': 'List the workspace agents (internal keys only)',
  'agents.write': 'Rename an agent and rewrite its instructions (internal keys only)',
  'sessions.read': 'Read sessions this key created (internal keys only)',
  'sessions.write': 'Create and run sessions with the full tool surface (internal keys only)',
  'projects.read': 'List the workspace-wide projects (internal keys only)',
  'automations.read': 'List automations and their runs (internal keys only)',
  'automations.write': 'Create, change, run, and delete automations (internal keys only)',
  'skills.read': 'List the skills an agent can load (internal keys only)',
  'usage.read': 'Read the workspace spend and credit balance (internal keys only)',
  'integrations.read': 'List the workspace integrations and their tools (internal keys only)',
  'workspace.read': 'Read the workspace name (internal keys only)',
  'workspace.write': 'Rename the workspace (internal keys only)',
  'chat.completions':
    'Drive an agent from an OpenAI or Anthropic SDK, no new client code (internal keys only)',
};

export const api_key_audience_choices: Record<
  ApiKeyAudience,
  { label: string; description: string }
> = {
  internal: {
    label: 'Internal',
    description: 'Full brain access, for tools you run yourself.',
  },
  external: {
    label: 'External',
    description: 'Customer-facing. Sensitive facts are filtered out of every answer.',
  },
};

export const api_key_scopes = keep_offered_scopes(
  Object.keys(api_key_scope_descriptions) as ApiKeyScope[],
);

export const api_key_access_choices = {
  full: {
    label: 'Full access',
    description: 'For your own code or an AI assistant you run. It can do anything you can here.',
    key_audience: 'internal',
    scopes: api_key_scopes,
  },
  memory: {
    label: 'Memory only',
    description:
      'For something your customers use. It can ask questions and read memory, nothing more. Sensitive facts stay out of its answers.',
    key_audience: 'external',
    scopes: ['answers.write', 'memory.read'],
  },
} as const satisfies Record<
  string,
  {
    label: string;
    description: string;
    key_audience: ApiKeyAudience;
    scopes: readonly ApiKeyScope[];
  }
>;

export type ApiKeyAccess = keyof typeof api_key_access_choices;
export const api_key_accesses = (Object.keys(api_key_access_choices) as ApiKeyAccess[]).filter(
  (access) => keep_offered_scopes(api_key_access_choices[access].scopes).length > 0,
);

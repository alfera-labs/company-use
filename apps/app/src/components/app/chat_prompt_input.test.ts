import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { create_chat_message_payload } from '@/components/app/chat_file_parts';
import {
  ChatProjectPickerControl,
  order_chat_projects,
} from '@/components/app/chat_project_picker';
import { ChatPromptInput } from '@/components/app/chat_prompt_input';
import { prompt_suggestions } from '@/components/app/chat_prompt_suggestions';
import { real_model_catalog_entries } from '@/components/app/model_picker/__tests__/real_model_catalog';
import {
  let_alfera_recommend,
  written_message_model,
} from '@/components/app/model_picker/model_choice';
import { query_keys } from '@/lib/api/query_keys';
import type { Project } from '@/lib/api/types';

// The router's Link needs a live RouterProvider above it, which nothing here mounts. The
// stand-in fills the path params and renders the same anchor the assertions read.
vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ to, params, preload, href, children, ...anchor }: StubLinkProps) =>
    createElement('a', { ...anchor, href: href ?? stub_link_href(to ?? '', params) }, children),
}));

vi.mock('@/lib/auth_client', () => ({
  useAuth: () => ({ user: null }),
}));

const shared_props = {
  attachments: [],
  onAttachmentRemove: vi.fn(),
  onFilesAdded: vi.fn(),
  onSend: vi.fn(),
  onStop: vi.fn(),
  onValueChange: vi.fn(),
};

function render_composer(
  props: Partial<Parameters<typeof ChatPromptInput>[0]> = {},
  query_data?: { models?: unknown[]; agents?: unknown[] },
) {
  const query_client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  if (query_data?.models) query_client.setQueryData(query_keys.models(), query_data.models);
  if (query_data?.agents) query_client.setQueryData(query_keys.agents(), query_data.agents);

  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: query_client },
      createElement(ChatPromptInput, {
        ...shared_props,
        isStreaming: false,
        value: '',
        ...props,
      }),
    ),
  );
}

describe('ChatPromptInput', () => {
  it('renders prompt category suggestions as non-submit buttons', () => {
    const html = render_composer({ onSuggestion: vi.fn(), showSuggestions: true });
    const first_category = prompt_suggestions[0]?.label;
    if (!first_category) throw new Error('Expected at least one prompt suggestion group.');
    const category_button = find_button_markup(html, first_category);

    expect(category_button).toContain('type="button"');
  });

  it('shows a neutral placeholder while the model catalog is loading', () => {
    const html = render_composer();

    expect(html).toContain('data-slot="skeleton"');
    expect(html).not.toContain('Recommended');
  });

  it('does not claim a recommendation when the current agent is unavailable', () => {
    const html = render_composer(
      {},
      {
        models: real_model_catalog_entries,
        agents: [],
      },
    );

    expect(html).toContain('Model unavailable');
    expect(html).toContain('aria-label="Retry loading the model picker"');
    expect(html).not.toContain('Recommended');
  });

  it('shows a stop button while streaming with no draft', () => {
    const html = render_composer({ isStreaming: true });

    expect(html).toContain('aria-label="Stop response"');
    expect(html).not.toContain('aria-label="Send message"');
  });

  it('keeps send available while streaming when the user drafts an interrupting message', () => {
    const html = render_composer({ isStreaming: true, value: 'interrupt this run' });

    const send_button = find_button_markup(html, 'aria-label="Send message"');
    expect(send_button).not.toContain('disabled=""');
    expect(html).not.toContain('aria-label="Stop response"');
  });

  it('renders personal, company, and custom projects in the menu order', () => {
    const projects: Project[] = [
      {
        created_time: '2026-09-09T00:00:00Z',
        last_updated_time: '2026-09-09T00:00:00Z',
        membership_version: 1,
        personal_for_user_id: null,
        project_access: 'members',
        project_description: null,
        project_id: 'launch',
        project_instructions: null,
        project_name: 'Launch',
        project_status: 'active',
        workspace_id: 'workspace',
        is_workspace_default: false,
      },
      {
        created_time: '2026-09-09T00:00:00Z',
        last_updated_time: '2026-09-09T00:00:00Z',
        membership_version: 1,
        personal_for_user_id: null,
        project_access: 'workspace',
        project_description: null,
        project_id: 'company',
        project_instructions: null,
        project_name: 'Stored company name',
        project_status: 'active',
        workspace_id: 'workspace',
        is_workspace_default: true,
      },
    ];
    const html = render_composer({
      projectPicker: createElement(ChatProjectPickerControl, {
        onProjectChange: vi.fn(),
        project_id: null,
        personal_initials: 'OP',
        projects,
        workspace_name: 'Acme',
      }),
    });

    expect(html).toContain('aria-label="Chat project: Personal"');
    expect(html).toContain('OP');
    expect(order_chat_projects(projects).map((project) => project.project_id)).toEqual([
      'company',
      'launch',
    ]);

    const company_html = render_composer({
      projectPicker: createElement(ChatProjectPickerControl, {
        onProjectChange: vi.fn(),
        project_id: 'company',
        projects,
        workspace_name: 'Acme',
      }),
    });
    expect(company_html).toContain('aria-label="Chat project: Acme"');
  });

  it('shows Google and Slack marks beside the integration link in the expanded composer', () => {
    const html = render_composer({ expanded: true });

    expect(html).toContain('aria-label="Google and Slack"');
    expect(html).toContain('Connect your apps');
  });

  it('sends a selected model as one explicit route', () => {
    const payload = create_chat_message_payload({
      attachments: [],
      message_text: 'Analyze the inbox',
      model: written_message_model({
        choose_model_by: 'use_this_exact_model',
        model_provider: 'anthropic',
        model_proxy: 'vercel_ai_gateway',
        model_name: 'anthropic/claude-opus-4.8',
      }),
    });

    expect(payload).toEqual({
      message: 'Analyze the inbox',
      model_provider: 'anthropic',
      model_proxy: 'vercel_ai_gateway',
      model_name: 'anthropic/claude-opus-4.8',
    });
  });

  it('sends a direct-provider pin as an explicit canonical route', () => {
    const payload = create_chat_message_payload({
      attachments: [],
      message_text: 'Analyze the inbox',
      model: written_message_model({
        choose_model_by: 'use_this_exact_model',
        model_provider: 'openai',
        model_proxy: 'openai_direct',
        model_name: 'gpt-5.5',
      }),
    });

    expect(payload).toEqual({
      message: 'Analyze the inbox',
      model_provider: 'openai',
      model_proxy: 'openai_direct',
      model_name: 'gpt-5.5',
    });
  });

  it('omits the model entirely when Alfera is left to recommend one', () => {
    const payload = create_chat_message_payload({
      attachments: [],
      message_text: 'Use whatever is best',
      model: written_message_model(let_alfera_recommend),
    });

    expect(payload).toEqual({ message: 'Use whatever is best' });
  });
});

function find_button_markup(html: string, label: string) {
  const buttons = html.match(/<button\b[\s\S]*?<\/button>/gu) ?? [];
  const button = buttons.find((item) => item.includes(label));
  expect(button).toBeDefined();
  return button ?? '';
}

// `/projects/$project_id/edit` plus { project_id } is `/projects/proj_mkt/edit`; the optional
// `{-$session_id}` segment drops out when no id was passed, the same as the router's own.
type StubLinkProps = {
  to?: string;
  href?: string;
  params?: Record<string, string> | undefined;
  preload?: unknown;
  children?: ReactNode;
  [key: string]: unknown;
};

function stub_link_href(to: string, params: Record<string, string> | undefined) {
  return to
    .replace(/\{-\$(\w+)\}/gu, (_segment, key: string) => params?.[key] ?? '')
    .replace(/\$(\w+)/gu, (_segment, key: string) => params?.[key] ?? '')
    .replace(/\/$/u, '');
}

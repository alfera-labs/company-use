// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectChannelsSection } from '@/components/app/project_channels_section';
import type { ProjectChannel } from '@/lib/api/types';

// Only the network boundary is replaced. The list, the Remove button and the refetch are real.
const api = vi.hoisted(() => ({
  list_project_channels: vi.fn(),
  remove_project_channel: vi.fn(),
}));
vi.mock('@/lib/api/endpoints', async (import_original) => ({
  ...(await import_original<typeof import('@/lib/api/endpoints')>()),
  ...api,
}));

// The router's Link needs a live RouterProvider above it, which nothing here mounts.
vi.mock('@tanstack/react-router', async (import_original) => ({
  ...(await import_original<typeof import('@tanstack/react-router')>()),
  Link: ({ to, children, ...anchor }: { to: string; children?: ReactNode }) =>
    createElement('a', { ...anchor, href: to }, children),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const sales_channel: ProjectChannel = {
  channel_route_id: 'chn_1',
  channel_provider_key: 'slack',
  channel_name: 'sales',
  external_conversation_id: 'C_SALES',
  channel_status: 'enabled',
};

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  api.remove_project_channel.mockResolvedValue(undefined);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function render_section(can_manage = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(ProjectChannelsSection, { project_id: 'proj_sales', can_manage }),
      ),
    ),
  );
  await vi.waitFor(() => {
    if (container.querySelector('[data-slot="skeleton"]')) throw new Error('Still loading');
  });
}

describe('the Slack channels section on a project page', () => {
  it('lists the channels and takes one out with Remove', async () => {
    api.list_project_channels.mockResolvedValue([sales_channel]);
    await render_section();
    expect(container.textContent).toContain('#sales');

    api.list_project_channels.mockResolvedValue([]);
    const remove = container.querySelector<HTMLButtonElement>(
      '[aria-label="Remove #sales from this project"]',
    );
    await act(async () => remove?.click());

    expect(api.remove_project_channel).toHaveBeenCalledWith({
      project_id: 'proj_sales',
      channel_route_id: 'chn_1',
    });
    await vi.waitFor(() => expect(container.textContent).not.toContain('#sales'));
  });

  it('shows someone who cannot manage the project the list and nothing to click', async () => {
    api.list_project_channels.mockResolvedValue([sales_channel]);
    await render_section(false);

    expect(container.textContent).toContain('#sales');
    expect(container.textContent).not.toContain('Remove');
  });

  it('points at Settings › Channels when no channel works here yet', async () => {
    api.list_project_channels.mockResolvedValue([]);
    await render_section();

    expect(container.textContent).toContain(
      'No Slack channels yet. Pick this project for a channel in Settings › Channels.',
    );
    expect(container.querySelector('a')?.getAttribute('href')).toBe('/settings/channels');
  });
});

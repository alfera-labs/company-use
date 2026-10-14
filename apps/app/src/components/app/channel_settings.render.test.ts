// @vitest-environment happy-dom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelSettings } from '@/components/app/channel_settings';
import { ApiError } from '@/lib/api/client';
import type { Project } from '@/lib/api/types';

// Only the network boundary is replaced. The row, the picker and the query wiring are real.
const api = vi.hoisted(() => ({
  get_onboarding: vi.fn(),
  list_slack_channel_settings: vi.fn(),
  list_projects: vi.fn(),
  set_slack_channel_access: vi.fn(),
}));
vi.mock('@/lib/api/endpoints', async (import_original) => ({
  ...(await import_original<typeof import('@/lib/api/endpoints')>()),
  ...api,
}));

const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

function project(project_id: string, project_name: string, personal_for_user_id: string | null) {
  return { project_id, project_name, personal_for_user_id } as Project;
}

const sales_channel = {
  id: 'C_SALES',
  name: 'sales',
  is_private: false,
  is_member: true,
  is_enabled: false,
  num_members: 4,
  project_id: null as string | null,
};

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  api.get_onboarding.mockResolvedValue({
    slack: { connected: true },
    install: { slack_app_configured: true },
  });
  api.list_slack_channel_settings.mockResolvedValue({
    channels: [sales_channel],
    next_cursor: null,
  });
  api.list_projects.mockResolvedValue([
    project('proj_sales', 'Sales', null),
    project('proj_mine', 'My room', 'usr_nina'),
  ]);
  api.set_slack_channel_access.mockResolvedValue({ project_id: 'proj_sales' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function render_settings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(createElement(QueryClientProvider, { client }, createElement(ChannelSettings))),
  );
  await act(async () => {});
}

async function open_picker() {
  const trigger = await vi.waitFor(() => {
    const found = document.querySelector<HTMLElement>('[aria-label="Project for #sales"]');
    if (!found) throw new Error('The project picker has not rendered yet');
    return found;
  });
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    trigger.click();
  });
  return [...document.querySelectorAll<HTMLElement>('[role="option"]')];
}

async function pick_project(project_name: string) {
  const option = (await open_picker()).find((one) => one.textContent?.trim() === project_name);
  expect(option).toBeDefined();
  await act(async () => option?.click());
  await act(async () => {});
}

describe('the project picker on a channel row', () => {
  it('puts the channel in the chosen project and turns it on', async () => {
    await render_settings();
    await pick_project('Sales');

    expect(api.set_slack_channel_access).toHaveBeenCalledWith({
      channel_id: 'C_SALES',
      enabled: true,
      project_id: 'proj_sales',
      channel_name: 'sales',
    });
    expect(toasts.success).toHaveBeenCalledWith('#sales now works in Sales');
  });

  it('offers shared projects only, never a personal room', async () => {
    await render_settings();
    const names = (await open_picker()).map((one) => one.textContent?.trim());

    expect(names).toEqual(['No project', 'Sales']);
  });

  it('takes the channel out of its project with No project', async () => {
    api.list_slack_channel_settings.mockResolvedValue({
      channels: [{ ...sales_channel, is_enabled: true, project_id: 'proj_sales' }],
      next_cursor: null,
    });
    await render_settings();
    await pick_project('No project');

    expect(api.set_slack_channel_access).toHaveBeenCalledWith(
      expect.objectContaining({ channel_id: 'C_SALES', project_id: null }),
    );
    expect(toasts.success).toHaveBeenCalledWith('#sales is no longer in a project');
  });

  // Leaving a project must not switch on a channel that was off.
  it('keeps an off channel off when No project is picked', async () => {
    api.list_slack_channel_settings.mockResolvedValue({
      channels: [{ ...sales_channel, is_enabled: false, project_id: 'proj_sales' }],
      next_cursor: null,
    });
    await render_settings();
    await pick_project('No project');

    expect(api.set_slack_channel_access).toHaveBeenCalledWith(
      expect.objectContaining({ channel_id: 'C_SALES', enabled: false, project_id: null }),
    );
  });

  it("shows the server's refusal when the person does not manage the project", async () => {
    api.set_slack_channel_access.mockRejectedValue(
      new ApiError('You cannot manage this project.', 403, 'project_access_denied'),
    );
    await render_settings();
    await pick_project('Sales');

    expect(toasts.error).toHaveBeenCalledWith('You cannot manage this project.');
  });
});

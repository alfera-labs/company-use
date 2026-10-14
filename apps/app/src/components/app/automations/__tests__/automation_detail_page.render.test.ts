// @vitest-environment happy-dom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  get_automation: vi.fn(),
  create_automation: vi.fn(),
  update_automation: vi.fn(),
  delete_automation: vi.fn(),
  provision_automation: vi.fn(),
  list_automation_fires: vi.fn(),
  list_trigger_types: vi.fn(),
  set_automation_status: vi.fn(),
}));
const navigate = vi.hoisted(() => vi.fn(async () => undefined));
const read_notification_rules = vi.hoisted(() => vi.fn());
const notification_policy = {
  dial: 'normal',
  quiet_hours: null,
  max_notifications_per_day: 5,
  daily_summary_at_time: '07:45',
  delivery_channel_order: ['slack_dm'],
  always_notify: [],
  never_notify: [],
};
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock('@/components/app/automations/automations_api', () => ({
  ...api,
  list_automations: async () => [],
  list_notifications: async () => ({ items: [] }),
  read_notification_rules,
  save_notification_rules: vi.fn(),
  run_automation_now: vi.fn(),
}));
const create_connection = vi.hoisted(() =>
  vi.fn(async () => ({ connection: { connection_id: 'conn_1' }, start_url: 'https://p/start' })),
);
vi.mock('@/lib/api', () => ({
  create_connection,
  list_workspace_members: async () => [],
  list_connections: async () => [],
  open_workspace_file_if_present: async () => null,
  relative_time: () => 'just now',
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => createElement('a', null, children),
  useNavigate: () => navigate,
}));
vi.mock('sonner', () => ({ toast }));

import { AutomationDetailPage } from '@/components/app/automations/automation_detail_page';
import { AutomationNewPage } from '@/components/app/automations/automation_new_page';

const gmail_node = 'composio_gmail-new_gmail_message-1';

function catalog(connected: boolean) {
  return {
    count: 1,
    apps: [
      {
        app_id: 'composio_gmail',
        app_display_name: 'Gmail',
        icon_url: null,
        connected,
        connection_id: connected ? 'conn_1' : null,
        trigger_types: [
          {
            node_key: gmail_node,
            display_name: 'New Gmail message',
            display_name_without_app: 'New message',
            description: null,
            setup_fields: [],
            input_schema: { properties: {}, required: [] },
            event_fields: [],
          },
        ],
      },
    ],
  };
}

const provider_refusal =
  'Polling trigger requested an interval of 0.5 minutes, but the minimum polling interval for GMAIL is 1 minute.';

const gmail_trigger = {
  trigger_id: 'trg_gmail',
  trigger_name: 'Mail arrives',
  trigger_type: 'app_event',
  trigger_status: 'enabled',
  schedule_expression: null,
  trigger_config: { event_source: { node_key: gmail_node, subscription_config: {} }, rules: [] },
  last_run_time: null,
  created_time: '2026-09-01T09:00:00.000Z',
};

function automation(fields: Record<string, unknown> = {}, triggers: unknown[] = [gmail_trigger]) {
  return {
    automation: {
      automation_id: 'atm_1',
      automation_name: 'Lead intake',
      automation_status: 'enabled',
      instruction: 'Answer the lead.',
      run_policy: { subject_from: null, when_a_run_is_already_going: 'wait_for_it_to_finish' },
      conditions: [],
      judge: null,
      created_by: 'user_1',
      ...fields,
    },
    triggers,
  };
}

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  for (const mock of [...Object.values(api), navigate, toast.success, toast.error]) {
    mock.mockReset();
  }
  api.get_automation.mockResolvedValue(automation());
  api.list_trigger_types.mockResolvedValue(catalog(true));
  api.list_automation_fires.mockResolvedValue({ items: [] });
  read_notification_rules.mockReset();
  read_notification_rules.mockResolvedValue({ policy: notification_policy });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(AutomationDetailPage, { automationId: 'atm_1' }),
      ),
    );
  });
  await settle();
}

async function settle() {
  for (let round = 0; round < 10; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function button(text: string) {
  const found = [...document.querySelectorAll<HTMLElement>('button, [role="menuitem"]')].find(
    (candidate) =>
      candidate.textContent?.trim() === text || candidate.getAttribute('aria-label') === text,
  );
  if (!found) throw new Error(`no button ${text}`);
  return found;
}

async function press(text: string) {
  await act(async () => button(text).click());
  await settle();
}

function rename(to: string) {
  const box = container.querySelector<HTMLInputElement>('[aria-label="Automation name"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(box, to);
    box?.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('the automation page', () => {
  it('takes the Save answer as the saved state: Save goes dark and a new trigger has its row', async () => {
    await mount();
    rename('Lead intake v2');
    expect(button('Save').hasAttribute('disabled')).toBe(false);

    const heard = {
      ...gmail_trigger,
      trigger_id: 'trg_manual',
      trigger_type: 'manual',
      last_run_time: '2026-09-20T09:00:00.000Z',
    };
    api.update_automation.mockResolvedValue(
      automation({ automation_name: 'Lead intake v2' }, [gmail_trigger, heard]),
    );
    await press('Save');

    expect(api.update_automation).toHaveBeenCalledOnce();
    expect(button('Save').hasAttribute('disabled')).toBe(true);
    expect(container.textContent).toContain('last event just now');
    expect(toast.success).toHaveBeenCalledWith('Saved');
  });

  it('asks before deleting, and deletes only on the second yes', async () => {
    api.delete_automation.mockResolvedValue({
      automation_id: 'atm_1',
      deleted: true,
      triggers: [{ trigger_id: 'trg_gmail', removed: true }],
    });
    await mount();
    await press('More');
    await press('Delete');

    expect(document.body.textContent).toContain('Delete Lead intake?');
    expect(document.body.textContent).toContain('Its triggers stop and it will not run again.');
    expect(api.delete_automation).not.toHaveBeenCalled();

    const confirm = [...document.querySelectorAll<HTMLElement>('[role="alertdialog"] button')].find(
      (candidate) => candidate.textContent === 'Delete',
    );
    await act(async () => confirm?.click());
    await settle();
    expect(api.delete_automation).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith({ to: '/automations' });
  });

  it('stays on the page and says so when a provider kept a trigger', async () => {
    api.delete_automation.mockResolvedValue({
      automation_id: 'atm_1',
      deleted: true,
      triggers: [{ trigger_id: 'trg_gmail', removed: false, error: 'provider said no' }],
    });
    await mount();
    await press('More');
    await press('Delete');
    const confirm = [...document.querySelectorAll<HTMLElement>('[role="alertdialog"] button')].find(
      (candidate) => candidate.textContent === 'Delete',
    );
    await act(async () => confirm?.click());
    await settle();

    expect(toast.error).toHaveBeenCalledWith(
      'Could not disconnect Gmail; it may still send events.',
    );
    expect(navigate).not.toHaveBeenCalled();
  });

  it('says a budget pause next to Paused, and nothing extra for a pause a person made', async () => {
    api.get_automation.mockResolvedValue(automation({ automation_status: 'paused' }));
    api.list_automation_fires.mockResolvedValue({
      items: [
        {
          event_id: 'evt_1',
          outcome: 'didnt_fire',
          reason: 'Paused by its budget.',
          skipped: null,
          judge: null,
          budget_limit: 50,
          told: null,
        },
      ],
    });
    await mount();
    expect(container.textContent).toContain('Paused: hit 50 events today');
    expect(container.textContent).toContain('Max runs per day');

    act(() => root.unmount());
    container.remove();
    api.list_automation_fires.mockResolvedValue({ items: [] });
    await mount();
    expect(container.textContent).toContain('Paused');
    expect(container.textContent).not.toContain('Paused: hit');
  });

  it('says Paused the moment the switch is turned off, and Active again when the server refuses', async () => {
    let refuse: (error: Error) => void = () => undefined;
    api.set_automation_status.mockReturnValue(
      new Promise((_resolve, reject) => {
        refuse = reject;
      }),
    );
    await mount();
    expect(container.textContent).toContain('Active');

    const live_switch = container.querySelector<HTMLElement>('[aria-label="Turn Lead intake off"]');
    await act(async () => live_switch?.click());
    await settle();
    expect(api.set_automation_status).toHaveBeenCalledWith('atm_1', 'paused');
    expect(container.textContent).toContain('Paused');
    expect(container.textContent).not.toContain('Active');

    await act(async () => refuse(new Error('nope')));
    await settle();
    expect(container.textContent).toContain('Active');
    expect(toast.error).toHaveBeenCalled();
  });

  it('starts a trigger saved before its app was connected, from Try again', async () => {
    const dead = {
      ...gmail_trigger,
      trigger_status: 'error',
      trigger_config: {
        ...gmail_trigger.trigger_config,
        provisioning_error: 'needs Gmail connected',
      },
    };
    api.get_automation.mockResolvedValue(automation({}, [dead]));
    api.provision_automation.mockResolvedValue(automation());
    await mount();
    expect(container.textContent).toContain('needs Gmail connected');
    expect(container.textContent).not.toContain('Start listening');

    await press('Try again');
    expect(api.provision_automation).toHaveBeenCalledWith('atm_1');
    expect(container.textContent).not.toContain('needs Gmail connected');
  });

  it('says which trigger is not running and why instead of "Saved"', async () => {
    await mount();
    rename('Lead intake v2');
    api.update_automation.mockResolvedValue(
      automation({ automation_name: 'Lead intake v2' }, [
        {
          ...gmail_trigger,
          trigger_status: 'error',
          trigger_config: {
            ...gmail_trigger.trigger_config,
            provisioning_error: provider_refusal,
          },
        },
      ]),
    );
    await press('Save');

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      `Saved, but New Gmail message is not running: ${provider_refusal}`,
    );
    expect(container.textContent).toContain(provider_refusal);
  });

  it('has no "Alfera understood" readback under the form', async () => {
    await mount();
    expect(container.textContent).not.toContain('Alfera understood');
  });

  it('uses the same line tabs as the rest of the app', async () => {
    await mount();
    expect(container.querySelector('[data-slot="tabs-list"]')?.getAttribute('data-variant')).toBe(
      'line',
    );
  });

  it('changes notifications in a dialog on the page and reads the policy again on close', async () => {
    await mount();
    rename('Lead intake v2');
    await press('Change');

    expect(document.body.textContent).toContain('Notify me');
    expect(navigate).not.toHaveBeenCalled();

    const reads_while_open = read_notification_rules.mock.calls.length;
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await settle();
    expect(document.body.textContent).not.toContain('Notify me');
    expect(read_notification_rules.mock.calls.length).toBeGreaterThan(reads_while_open);
    expect(name_box().value).toBe('Lead intake v2');
  });

  it('connects an app in a popup and keeps what was typed', async () => {
    api.list_trigger_types.mockResolvedValue(catalog(false));
    const open = vi.fn();
    vi.stubGlobal('open', open);
    await mount();
    rename('Lead intake v2');

    await press('Connect Gmail');
    expect(create_connection).toHaveBeenCalledWith(
      expect.objectContaining({ app_id: 'composio_gmail' }),
    );
    expect(open).toHaveBeenCalledWith('https://p/start', '_blank', 'noopener,noreferrer');
    expect(container.textContent).toContain('Connecting Gmail');

    api.list_trigger_types.mockResolvedValue(catalog(true));
    await popup_returns();

    expect(container.textContent).not.toContain('Connect Gmail');
    expect(name_box().value).toBe('Lead intake v2');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('starts listening by itself when the connected app was what a saved trigger waited on', async () => {
    api.get_automation.mockResolvedValue(
      automation({}, [{ ...gmail_trigger, trigger_status: 'error' }]),
    );
    api.list_trigger_types.mockResolvedValue(catalog(false));
    api.provision_automation.mockResolvedValue(automation());
    vi.stubGlobal('open', vi.fn());
    await mount();

    await press('Connect Gmail');
    api.list_trigger_types.mockResolvedValue(catalog(true));
    await popup_returns();

    expect(api.provision_automation).toHaveBeenCalledWith('atm_1');
  });

  it('says so and stays put when the popup comes back with an error', async () => {
    api.list_trigger_types.mockResolvedValue(catalog(false));
    vi.stubGlobal('open', vi.fn());
    await mount();

    await press('Connect Gmail');
    await popup_returns({ status: 'error', error_message: 'access_denied' });

    expect(toast.error).toHaveBeenCalledWith('access_denied');
    expect(container.textContent).toContain('Connect Gmail');
  });
});

function name_box() {
  const box = container.querySelector<HTMLInputElement>('[aria-label="Automation name"]');
  if (!box) throw new Error('no name box');
  return box;
}

async function popup_returns(fields: Record<string, unknown> = {}) {
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'coworker.connection_setup_return',
          status: 'success',
          connection_id: 'conn_1',
          returned_time: new Date().toISOString(),
          ...fields,
        },
      }),
    );
  });
  await settle();
}

describe('a web-call trigger that was just made', () => {
  const the_secret = 'a'.repeat(43);
  const the_address = 'http://localhost:3393/v1/triggers/deliveries/webhook/trg_web';
  const web_call_trigger = {
    ...gmail_trigger,
    trigger_id: 'trg_web',
    trigger_name: 'Orders',
    trigger_type: 'webhook',
    trigger_config: { starts_job_handler: 'run_automation' },
    web_call_address: { webhook_url: the_address, reaches_outside_this_machine: false },
  };
  const just_made = { ...web_call_trigger, new_webhook_secret: the_secret };
  const shown = (label: string) =>
    document.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)?.value ?? null;

  function type_into(label: string, text: string) {
    const box = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[aria-label="${label}"]`,
    );
    if (!box) throw new Error(`no box ${label}`);
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(box), 'value')?.set;
    act(() => {
      setter?.call(box, text);
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }

  async function mount_the_new_page() {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(createElement(QueryClientProvider, { client }, createElement(AutomationNewPage)));
    });
    await settle();
  }

  async function add_a_web_call_trigger() {
    await press('Add trigger');
    await press('When anything on the web calls it');
  }

  it('shows the address and the secret after Create, and goes to the list only on Done', async () => {
    api.create_automation.mockResolvedValue(automation({}, [just_made]));
    await mount_the_new_page();
    type_into('Automation name', 'Orders from the shop');
    type_into('Instructions', 'Read the order and file it.');
    await add_a_web_call_trigger();
    expect(container.textContent).toContain('Save to get its address and its secret.');

    await press('Create');

    expect(api.create_automation).toHaveBeenCalledOnce();
    expect(shown('Web-call address')).toBe(the_address);
    expect(shown('Web-call secret')).toBe(the_secret);
    expect(document.body.textContent).toContain('It is shown only now.');
    expect(document.body.textContent).toContain('remove this trigger and add it again');
    expect(document.body.textContent).toContain('needs a public address: run ./alfera add https');
    expect(button('Copy the Web-call secret')).toBeTruthy();
    expect(button('Copy the Web-call address')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await settle();

    expect(shown('Web-call secret')).toBe(the_secret);
    expect(navigate).not.toHaveBeenCalled();

    await press('Done');

    expect(navigate).toHaveBeenCalledWith({ to: '/automations' });
    expect(shown('Web-call secret')).toBeNull();
  });

  it('shows them after a Save that adds the trigger to an automation that exists, and stays until Done', async () => {
    api.update_automation.mockResolvedValue(automation({}, [gmail_trigger, just_made]));
    await mount();
    await add_a_web_call_trigger();

    await press('Save');

    expect(shown('Web-call secret')).toBe(the_secret);
    expect(navigate).not.toHaveBeenCalled();

    await press('Done');

    expect(navigate).toHaveBeenCalledWith({ to: '/automations' });
  });

  it('shows the address on the trigger row when the automation is read again, and no secret', async () => {
    api.get_automation.mockResolvedValue(automation({}, [web_call_trigger]));

    await mount();

    expect(shown('Web-call address')).toBe(the_address);
    expect(button('Copy the Web-call address')).toBeTruthy();
    expect(shown('Web-call secret')).toBeNull();
    expect(document.body.innerHTML).not.toContain(the_secret);
    expect(document.body.textContent).not.toContain('It is shown only now.');
  });

  it('says nothing about this machine when the address is a public one', async () => {
    const public_address = {
      webhook_url: 'https://alfera.example.com/v1/triggers/deliveries/webhook/trg_web',
      reaches_outside_this_machine: true,
    };
    api.get_automation.mockResolvedValue(
      automation({}, [{ ...web_call_trigger, web_call_address: public_address }]),
    );

    await mount();

    expect(shown('Web-call address')).toBe(public_address.webhook_url);
    expect(document.body.textContent).not.toContain('only on the machine');
  });
});

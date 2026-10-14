import { configure_automation_lifecycle } from '@runtime-platform/automations/automation_lifecycle';

async function load_api_automation_lifecycle() {
  const { automation_lifecycle } = await import('@api/services/automations/automation_lifecycle');
  return automation_lifecycle;
}

configure_automation_lifecycle({
  create_automation: async (db, input) =>
    (await load_api_automation_lifecycle()).create_automation(db, input),
  update_automation: async (db, input) =>
    (await load_api_automation_lifecycle()).update_automation(db, input),
  set_automation_status: async (db, input) =>
    (await load_api_automation_lifecycle()).set_automation_status(db, input),
  delete_automation: async (db, input) =>
    (await load_api_automation_lifecycle()).delete_automation(db, input),
  run_automation_now: async (db, input) =>
    (await load_api_automation_lifecycle()).run_automation_now(db, input),
  create_scheduled_task: async (db, input) =>
    (await load_api_automation_lifecycle()).create_scheduled_task(db, input),
  update_scheduled_task: async (db, input) =>
    (await load_api_automation_lifecycle()).update_scheduled_task(db, input),
  delete_scheduled_task: async (db, input) =>
    (await load_api_automation_lifecycle()).delete_scheduled_task(db, input),
  list_scheduled_tasks: async (db, input) =>
    (await load_api_automation_lifecycle()).list_scheduled_tasks(db, input),
  reprovision_trigger_schedule: async (trigger) =>
    (await load_api_automation_lifecycle()).reprovision_trigger_schedule(trigger),
});

// Web storage for DOM tests. Node 26 defines `localStorage` and `sessionStorage` on
// globalThis, where they read as `undefined` unless the process was started with
// --localstorage-file. Vitest's DOM environments copy a window key onto the global only
// when the global does not already have that key, so happy-dom's own storage is skipped
// and `window` (which vitest points at globalThis) is left with Node's empty pair. Any
// component that remembers something across a reload then throws inside its test.
//
// Give every DOM test file its own pair of real happy-dom Storage objects. Node-environment
// tests keep the platform globals untouched.
if ((globalThis as { window?: unknown }).window) {
  const { Storage } = await import('happy-dom');

  for (const key of ['localStorage', 'sessionStorage'] as const) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: new Storage(),
    });
  }
}

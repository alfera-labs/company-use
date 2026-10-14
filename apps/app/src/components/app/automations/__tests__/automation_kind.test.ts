import { expect, it } from 'vitest';
import { kind_of_trigger_types } from '@/components/app/automations/automation_kind';

it('calls an automation scheduled when only a clock starts it', () => {
  expect(kind_of_trigger_types(['schedule'])).toBe('scheduled');
  expect(kind_of_trigger_types(['schedule', 'schedule'])).toBe('scheduled');
});

it('still calls it scheduled after Test added a "When you ask" start to it', () => {
  expect(kind_of_trigger_types(['schedule', 'manual'])).toBe('scheduled');
});

it('calls it a trigger when an app, the web or only a request starts it', () => {
  expect(kind_of_trigger_types(['schedule', 'app_event'])).toBe('trigger');
  expect(kind_of_trigger_types(['webhook'])).toBe('trigger');
  expect(kind_of_trigger_types(['manual'])).toBe('trigger');
  expect(kind_of_trigger_types([])).toBe('trigger');
});

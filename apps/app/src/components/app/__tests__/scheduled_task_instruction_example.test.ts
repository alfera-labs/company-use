import { expect, it } from 'vitest';
import { scheduled_task_instruction_example } from '@/components/app/scheduled_task_instruction_field';

it('gives an example the install can do when no app can be connected', () => {
  const example = scheduled_task_instruction_example({ install_has_app_catalogue: false });

  expect(example).not.toMatch(/meeting|email/iu);
  expect(example).toContain('files/');
});

it('keeps the meetings and emails example where apps can be connected', () => {
  expect(scheduled_task_instruction_example({ install_has_app_catalogue: true })).toContain(
    'unread emails',
  );
  expect(scheduled_task_instruction_example({ install_has_app_catalogue: undefined })).toContain(
    'unread emails',
  );
});

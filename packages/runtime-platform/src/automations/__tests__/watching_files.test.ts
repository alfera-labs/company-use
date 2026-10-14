import type { Database } from '@coworker/core';
import { build_automation_run_instruction } from '@runtime-platform/automations/automation_run_instruction';
import {
  list_watching_notes,
  parse_watching_note,
  watching_file_path,
} from '@runtime-platform/automations/watching_files';
import type { WorkspaceVolumeAddress } from '@runtime-platform/files/workspace_volume_browser';
import { current_workspace_layout } from '@runtime-platform/storage/workspace_layouts';
import { describe, expect, it } from 'vitest';

const address: WorkspaceVolumeAddress = {
  volume_id: 'vol_1',
  provider_volume_id: 'pvol_1',
  region: undefined,
  volume_workspace_path: 'agents/agt_1/workspace',
  layout: current_workspace_layout,
};

const note_text = [
  '---',
  'automation_id: atm_1',
  'subject: The Acme invoice',
  'since: 2026-09-10',
  '---',
  "Waiting on the customer's reply since Tue. Chased once on Wednesday.",
  '',
].join('\n');

describe('what an automation is waiting on', () => {
  it('lives at a path both the run and the page can work out from the name', () => {
    expect(watching_file_path('Answer billing questions')).toBe(
      'watching/answer-billing-questions.md',
    );
  });

  it('is read back with its subject, its date and the note itself', () => {
    expect(parse_watching_note('answer-billing-questions', note_text)).toEqual({
      slug: 'answer-billing-questions',
      automation_id: 'atm_1',
      subject: 'The Acme invoice',
      since: '2026-09-10',
      notes: "Waiting on the customer's reply since Tue. Chased once on Wednesday.",
    });
  });

  it('is not a note when the frontmatter says nothing about a wait', () => {
    expect(parse_watching_note('scratch', '# some notes\n')).toBeNull();
    expect(
      parse_watching_note('scratch', '---\nsubject: a thing\n---\nno automation\n'),
    ).toBeNull();
  });

  it('lists every note on the volume and ignores the rest of the folder', async () => {
    const notes = await list_watching_notes(
      {} as Database,
      { workspace_id: 'ws_1', agent_id: 'agt_1' },
      {
        resolve_address: async () => address,
        list_folder: async () => ({
          folder_names: [],
          files: [
            { file_name: 'answer-billing-questions.md', byte_size: 1, last_modified_time: null },
            { file_name: 'README.txt', byte_size: 1, last_modified_time: null },
          ],
        }),
        read_file: async () => new TextEncoder().encode(note_text),
      },
    );
    expect(notes.map((note) => note.subject)).toEqual(['The Acme invoice']);
  });

  it('tells the run to read its note first and to write it when it ends up waiting', () => {
    const instruction = build_automation_run_instruction({
      automation_name: 'Answer billing questions',
      automation_id: 'atm_1',
      instruction: 'Answer billing questions.',
      subject_value: 'a thread',
      subject_is_known: true,
      subject_is_resolved: false,
    });

    expect(instruction).toContain('watching/answer-billing-questions.md');
    expect(instruction).toContain('automation_id: atm_1');
    expect(instruction).toContain('Read that file first');
  });
});

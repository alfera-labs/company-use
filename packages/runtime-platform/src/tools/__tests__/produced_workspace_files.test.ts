import {
  current_workspace_layout,
  workspace_layout_for_version,
} from '@runtime-platform/storage/workspace_layouts';
import {
  produced_file_kind,
  produced_file_metadata,
} from '@runtime-platform/tools/produced_workspace_files';
import { describe, expect, it } from 'vitest';

const laid_out_by_the_platform = { layout: current_workspace_layout, is_on_this_machine: true };
const laid_out_by_the_owner = {
  layout: workspace_layout_for_version(1),
  is_on_this_machine: true,
};
const in_a_remote_sandbox = { layout: current_workspace_layout, is_on_this_machine: false };

describe('which written files are files the session made', () => {
  it.each([
    ['hello.md', 'file'],
    ['reports/2026/payouts.csv', 'file'],
    ['site/index.html', 'file'],
    ['files/report.pdf', 'file'],
    ['artifacts/chart.png', 'file'],
    ['screenshots/home.png', 'screenshot'],
    ['downloads/invoice.pdf', 'download'],
  ])('counts %s', (workspace_path, kind) => {
    expect(produced_file_kind(workspace_path, laid_out_by_the_platform)).toBe(kind);
  });

  it.each([
    'people/a_person.md',
    'companies/northwind.md',
    'websites/portal.md',
    'tools/billing_api.md',
    'events/2026-10-12.md',
    'tasks/renewal.md',
    'daily-logs/2026-10-12.md',
    'skills/weekly-report/SKILL.md',
    'system/activity/2026-10-12.md',
    'tmp/draft.md',
    'tmp/build/out.csv',
    '.env',
    '.venv/lib/site.py',
    'site/.cache/page.html',
    'README.md',
    'WORKSPACE.md',
    'user.md',
    '/memory/sales/notes.md',
  ])('does not count %s, a place the workspace gives another job', (workspace_path) => {
    expect(produced_file_kind(workspace_path, laid_out_by_the_platform)).toBeUndefined();
  });

  it('counts a page with the name of a root page when it is in a folder of its own', () => {
    expect(produced_file_kind('site/README.md', laid_out_by_the_platform)).toBe('file');
  });

  it('keeps the old rule in a workspace its owner laid out: only the folders for produced files', () => {
    expect(produced_file_kind('files/report.pdf', laid_out_by_the_owner)).toBe('file');
    expect(produced_file_kind('logs/build.log', laid_out_by_the_owner)).toBe('log');
    expect(produced_file_kind('hello.md', laid_out_by_the_owner)).toBeUndefined();
    expect(produced_file_kind('memory/notes.md', laid_out_by_the_owner)).toBeUndefined();
  });

  it('keeps the old rule in a remote sandbox, where each record costs a read from the sandbox', () => {
    expect(produced_file_kind('files/report.pdf', in_a_remote_sandbox)).toBe('file');
    expect(produced_file_kind('hello.md', in_a_remote_sandbox)).toBeUndefined();
    expect(produced_file_kind('site/index.html', in_a_remote_sandbox)).toBeUndefined();
  });

  it('marks the result of a write so the file gets a record, and only then', () => {
    expect(produced_file_metadata('hello.md', laid_out_by_the_platform)).toEqual({
      workspace_path: 'hello.md',
      produced_workspace_path: 'hello.md',
      produced_artifact_kind: 'file',
    });
    expect(produced_file_metadata('people/a_person.md', laid_out_by_the_platform)).toEqual({
      workspace_path: 'people/a_person.md',
    });
  });
});

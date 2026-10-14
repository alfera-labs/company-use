import type { RunAudience } from '@runtime-platform/orchestrator/run_audience';
import {
  current_workspace_layout,
  procedures_folder,
  type WorkspaceLayout,
} from '@runtime-platform/storage/workspace_layouts';
import { private_tool_output_folder } from '@runtime-platform/tools/tool_output_path';
import { private_activity_folder } from '@runtime-platform/tools/workspace_activity_log';

type WorkspaceShape = {
  layout: WorkspaceLayout;
  has_procedures: boolean;
  has_files: boolean;
};

const lines_by_audience: Readonly<
  Record<RunAudience, { activity: (layout: WorkspaceLayout) => string; daily_log: string }>
> = {
  workspace: {
    activity: (layout) =>
      `system/ is written for you, not by you. ${layout.activity_folder}/ holds every tool call you have made, one file per day, and ${layout.tool_output_folder}/ holds results too big to show you in full. Read them when you need to know what you already did, especially after an interruption. Never write to system/.`,
    daily_log:
      'Append one short entry to daily-logs/<today>.md at the very end, once, after the work is done: what you did, what changed, what is still open. Writing it before the work finishes costs a second call to correct it, and a log that describes what you were about to do is a log that can be wrong.',
  },
  narrow: {
    activity: () =>
      `system/ is written for you, not by you. This chat's own tool calls are in ${private_activity_folder}/, one file per day, and results too big to show you in full are in ${private_tool_output_folder}/. Both stay with this chat only: they never reach the shared workspace, and when this chat moves to a new sandbox the most recent ones are put back. Read them when you need to know what you already did, especially after an interruption. Never write to system/.`,
    daily_log:
      'This chat is private to the people in it, so it is not logged: never write it into daily-logs/, which every chat in this workspace can read.',
  },
};

function describe_root_folders({ layout, has_procedures, has_files }: WorkspaceShape) {
  const knows = layout.memory_folders.join(', ');
  if (!knows) {
    return 'It already has its own folders. Work inside them and follow the shape that is there: it is the shape its owner built, not one to replace. Only the workspace lasts: /tmp and anything outside it are erased when this run ends.';
  }
  return `The folders at its root are what you know: ${knows}, and ${layout.memory_files.join(', ')}.${
    has_procedures ? ` ${procedures_folder}/ is how you work.` : ''
  }${
    has_files ? ' files/ is what you produce.' : ''
  } Create a folder when the standard ones do not fit, inside the workspace. Only the workspace lasts: /tmp and anything outside it are erased when this run ends.`;
}

function describe_system_folder(layout: WorkspaceLayout, run_audience: RunAudience) {
  if (layout.activity_folder) return lines_by_audience[run_audience].activity(layout);
  return `${layout.tool_output_folder}/ holds results too big to show you in full. Read one when you need what a tool actually returned.`;
}

function describe_page_rules({ has_files }: WorkspaceShape) {
  return [
    'One thing, one file, named with a stable slug. Before you create anything, list the folder, read its index.md, and grep the name — including before you search the web for something this workspace may already know. If it exists, open it and change what is wrong: never a second page for the same person or company, never a copy beside it, never a _v2, _new, _final or _fixed name, and one script patched between runs rather than a new one per attempt.',
    'Create with workspace-write_file, change part of a file with workspace-edit_file, read with workspace-read_file. Read before you edit. Do not build files from shell heredocs or cat what you can read.',
    `tmp/ is erased at the end of the run: scratch scripts and anything mid-process live there.${
      has_files ? ' files/ is for finished work you would hand over.' : ''
    } A shell command that changes a file meant to survive names it in writable_paths, or names its parent when it renames or replaces it.`,
    'Write what you learn where it belongs, the moment you learn it. A fact that exists only in this conversation is gone when the run ends.',
    'Every claim on a page carries a source pointer: a link to the day it came from, and the session id when you have one.',
    `Keep pages short and link between them. Never paste a raw payload into a page: save the bytes${
      has_files ? ' under files/' : ''
    } and write the path.`,
  ];
}

function describe_procedures() {
  return `When you finish work this workspace will plainly repeat, write the procedure down first, then offer to put it on a schedule. A procedure is a FOLDER: ${procedures_folder}/<slug>/SKILL.md carries the trigger and the steps in order, and any step that needs more than a few lines gets its own file beside it, e.g. ${procedures_folder}/<slug>/procedures/01-step.md, linked from the step. Loading a skill lists those files; read one when you reach its step.`;
}

/**
 * The Workspace Protocol. A run narrower than the workspace keeps its tool calls in sandbox
 * scratch and writes no daily-log entry, because every chat in the workspace reads the volume.
 * The text depends only on the layout and the audience, so the cached prompt stays stable per room.
 */
export function build_workspace_protocol(input: {
  workspace_root: string;
  workspace_layout?: WorkspaceLayout;
  run_audience?: RunAudience;
}) {
  const layout = input.workspace_layout ?? current_workspace_layout;
  const run_audience = input.run_audience ?? 'narrow';
  const shape: WorkspaceShape = {
    layout,
    has_procedures: layout.folders.some((folder) => folder.path === procedures_folder),
    has_files: layout.folders.some((folder) => folder.path === 'files'),
  };
  return [
    '## Workspace Protocol',
    `Your workspace is a durable folder at ${input.workspace_root}. It survives every run, and keeping it in order is part of the job.`,
    describe_root_folders(shape),
    describe_system_folder(layout, run_audience),
    ...describe_page_rules(shape),
    ...(layout.memory_folders.includes('daily-logs')
      ? [lines_by_audience[run_audience].daily_log]
      : []),
    ...(shape.has_procedures ? [describe_procedures()] : []),
  ].join('\n');
}

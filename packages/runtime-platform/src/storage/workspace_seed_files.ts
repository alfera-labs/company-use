import {
  current_workspace_layout,
  procedures_folder,
  type WorkspaceFolder,
  type WorkspaceLayout,
} from '@runtime-platform/storage/workspace_layouts';

export const example_procedure_slug = 'example-procedure';

const workspace_readme = `# How this workspace works

This folder is durable. It survives every run. It is the only thing that does.

## What is here

- The folders at this level are what I know: people, companies, websites, tools, events,
  tasks, and a log per day. \`user.md\` is who I work for.
- \`${procedures_folder}/\` is how I work. One FOLDER per procedure: \`SKILL.md\` is the entry point,
  and a step that needs more room gets its own file beside it, e.g. \`procedures/01-step.md\`.
- \`files/\` is what I made or downloaded.
- \`system/\` is written for me, not by me. \`system/activity/\` is every tool call I have made,
  one file per day. \`system/tool-output/\` holds results too big to show me in full. Read them
  when I need to know what I already did. Never write to \`system/\`.

Anything else I need, I create, inside this folder. Anything under this folder lasts.
\`/tmp\` does not, and neither does anything outside this folder.

## The rules of the house

1. One page per thing, named with a stable slug. Find it and edit it. Never open a second
   page for the same thing.
2. Look before I create anything. List the folder, read its \`index.md\`, grep for the name.
   If it already exists, open it and change what is wrong. Never a second copy beside it,
   and never a \`_v2\`, \`_new\`, \`_final\`, \`_fixed\`, or \`_copy\` name. Same for scripts:
   keep one and patch it between runs.
3. Every claim carries a source pointer: the day it came from, and the session id when there
   is one.
4. Link between pages. Do not copy from one into another.
5. Never paste a raw payload into a page. Save the bytes under \`files/\` and write the path.
6. Read \`index.md\` before searching a folder. Read \`WORKSPACE.md\` before searching anything.
7. Write the day's entry into \`daily-logs/\` before the run ends.
8. When work will repeat, write the procedure into \`${procedures_folder}/\` before offering to schedule it.

## Making and reading files

- Create with \`workspace-write_file\`, change part of one with \`workspace-edit_file\`, read with
  \`workspace-read_file\`. Do not build a file out of shell heredocs, and do not \`cat\` a file I
  can read. Read a file before editing it.
- \`tmp/\` is erased when the run ends. Working files, scratch scripts, downloads I am still
  processing: all of it goes there.
- \`files/\` is what I would hand to the person. A thing goes there when it is finished, under
  a name that says what it is.
- When a shell command changes a file that must survive, name that file in \`writable_paths\`.
  Name its parent directory instead when the command renames, replaces, or deletes it.
- Paths are relative to this folder, and every tool addresses the same root, so a path one
  tool writes is the path another tool opens.

## The formats

A page: a title, a two-line summary, the sections it needs, then \`## Source pointers\`.
A daily log: what happened, what changed, what is still open.
A procedure: a folder. \`SKILL.md\` carries a name, a description and the steps in order;
each step that needs detail links to its own file in the same folder.
`;

const user_page = `# The person I work for

Nothing is known yet. Fill this in from what they tell you, never from a guess.

## Who they are

## How they want to be worked with

## Source pointers
`;

const example_procedure = `---
name: ${example_procedure_slug}
description: A template showing how a procedure is written. Replace it with a real one.
---

# Example procedure

This file exists to show the shape. It is not a real procedure, so do not follow it.

Every procedure is a FOLDER. \`SKILL.md\` is the entry point and stays short enough to read
in one go. A step that needs more than a few lines gets its own file next to it, and this
file links to it:

\`\`\`
${procedures_folder}/${example_procedure_slug}/
  SKILL.md                        this file: when to use it, and the steps in order
  procedures/01-first-step.md     the detail of step 1, read only when you reach step 1
  procedures/02-second-step.md
  reference/field-mapping.md      anything the steps refer to but do not inline
\`\`\`

## When to use this

Say the trigger in one line: the kind of request or event this handles.

## Steps

1. Name the first action, and the tool that does it. Detail: \`procedures/01-first-step.md\`.
2. Name what to check before moving on.
3. Say what "done" looks like, and what to tell the person.

## When it goes wrong

Name the failure you have actually seen, and what to do instead.
`;

const example_procedure_step = `# Step 1

This file is the detail of one step. It exists so SKILL.md can stay short.

Write here what someone doing this step for the first time would need: the exact tool call,
the field names, the thing that looks right but is not. Link to a sibling file rather than
repeating what it already says.
`;

const example_procedure_sidecar = `{
  "alfera_skill_version": 1,
  "preloaded_tool_keys": [],
  "available_on_source_types": null,
  "origin": "platform_example",
  "installed_from_template_id": null
}
`;

type WorkspaceSeedFile = {
  readonly path: string;
  readonly content: string;
};

/**
 * The index.md a folder starts with. It carries the page contract, not just a heading: this
 * is the file the agent is told to read before it creates anything in the folder, so it is
 * the last thing it sees before writing a page and the right place to say what a page owes.
 */
export function folder_index_seed(folder: WorkspaceFolder) {
  return `# ${folder.path}

${capitalize_first(folder.holds)}.

One line per page here, saying what it holds. Keep it current: a page that is not in this
list is a page the next run will not find, and will write again.

## Before adding a page

Read this list and grep the folder first. If the thing already has a page, open that page and
change what is wrong. One thing, one page, named with a stable slug that will not change.

## What every page owes

- A title, then a two-line summary. Then whatever sections the thing needs.
- **A source pointer on every claim.** Link the day it came from:
  \`[2026-08-06](../daily-logs/2026-08-06.md)\`. A claim with no pointer is a rumour, and the
  next run cannot tell what it can trust.
- A \`## Source pointers\` section at the end with the session id when there is one.
- Links to other pages instead of copies of them. A page that restates another goes stale in
  two directions.
- Paths, not payloads. Bytes go under \`files/\`; the page carries the path.

_Nothing here yet._
`;
}

/** Every file a new workspace is seeded with, including each folder's index.md. */
export function workspace_seed_files(layout: WorkspaceLayout = current_workspace_layout) {
  const files: WorkspaceSeedFile[] = [
    { path: 'README.md', content: workspace_readme },
    { path: 'user.md', content: user_page },
    {
      path: `${procedures_folder}/${example_procedure_slug}/SKILL.md`,
      content: example_procedure,
    },
    {
      path: `${procedures_folder}/${example_procedure_slug}/alfera.json`,
      content: example_procedure_sidecar,
    },
    {
      path: `${procedures_folder}/${example_procedure_slug}/procedures/01-first-step.md`,
      content: example_procedure_step,
    },
  ];

  for (const folder of layout.folders) {
    if (!folder.seed_index) continue;
    files.push({ path: `${folder.path}/index.md`, content: folder_index_seed(folder) });
  }

  return files;
}

function capitalize_first(text: string) {
  return text.length === 0 ? text : `${text[0]?.toUpperCase() ?? ''}${text.slice(1)}`;
}

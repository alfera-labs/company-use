const {
  list_files,
  read_file,
  write_file,
  edit_file,
  search_files,
} = require('./folder_file_tools.cjs');
const { run_command, maximum_command_seconds } = require('./folder_command_tool.cjs');
const { FolderToolError } = require('./folder_paths.cjs');

const text = (description) => ({ type: 'string', description });
const reads_only = { readOnlyHint: true, destructiveHint: false };
const changes_files = { readOnlyHint: false, destructiveHint: true };

// Every tool Alfera gets for the folder. Alfera reads this list once and asks the person before
// it runs any tool that is not marked read-only.
const folder_tools = [
  {
    name: 'list_files',
    title: 'List files',
    description: 'List the files and folders in the folder the person chose on their computer.',
    annotations: reads_only,
    properties: {
      path: text('Folder to list, relative to the chosen folder. Default: the chosen folder.'),
      depth: { type: 'number', description: 'How many levels down to list, 1 to 4. Default 1.' },
    },
    required: [],
    run: list_files,
  },
  {
    name: 'read_file',
    title: 'Read a file',
    description: "Read a text file from the folder on the person's computer.",
    annotations: reads_only,
    properties: {
      path: text('File to read, relative to the chosen folder.'),
      start_line: { type: 'number', description: 'First line to return. Default 1.' },
      line_count: { type: 'number', description: 'How many lines to return. Default 2000.' },
    },
    required: ['path'],
    run: read_file,
  },
  {
    name: 'search_files',
    title: 'Search in files',
    description:
      "Find lines that match a regular expression in the folder on the person's computer.",
    annotations: reads_only,
    properties: {
      pattern: text('Extended regular expression to look for.'),
      path: text('File or folder to search, relative to the chosen folder. Default: all of it.'),
      case_sensitive: { type: 'boolean', description: 'Default true.' },
    },
    required: ['pattern'],
    run: search_files,
  },
  {
    name: 'write_file',
    title: 'Write a file',
    description:
      "Create a file, or replace all of its content, in the folder on the person's computer.",
    annotations: changes_files,
    properties: {
      path: text('File to write, relative to the chosen folder.'),
      content: text('The full new content.'),
    },
    required: ['path', 'content'],
    run: write_file,
  },
  {
    name: 'edit_file',
    title: 'Edit a file',
    description: "Replace one piece of text in a file in the folder on the person's computer.",
    annotations: changes_files,
    properties: {
      path: text('File to edit, relative to the chosen folder.'),
      old_text: text('The exact text to replace.'),
      new_text: text('The text to put in its place.'),
      replace_all: {
        type: 'boolean',
        description: 'Replace every place the text appears. Default false.',
      },
    },
    required: ['path', 'old_text', 'new_text'],
    run: edit_file,
  },
  {
    name: 'run_command',
    title: 'Run a command',
    description:
      "Run a shell command on the person's computer, starting in the chosen folder. It can write only inside that folder.",
    annotations: changes_files,
    properties: {
      command: text('The command line, run with sh.'),
      timeout_seconds: {
        type: 'number',
        description: `Default 60, at most ${maximum_command_seconds}.`,
      },
    },
    required: ['command'],
    run: run_command,
  },
];

function validate_arguments(tool, given) {
  for (const name of tool.required) {
    if (given[name] === undefined) throw new FolderToolError(`${tool.name} needs "${name}".`);
  }
  for (const [name, value] of Object.entries(given)) {
    const expected = tool.properties[name]?.type;
    if (!expected) throw new FolderToolError(`${tool.name} does not take "${name}".`);
    if (typeof value !== expected) throw new FolderToolError(`"${name}" must be a ${expected}.`);
  }
}

async function run_folder_tool(folder, name, given = {}) {
  const tool = folder_tools.find((candidate) => candidate.name === name);
  if (!tool) return { text: `There is no tool named "${name}".`, failed: true };
  try {
    validate_arguments(tool, given);
    const outcome = await tool.run(folder, given);
    return typeof outcome === 'string' ? { text: outcome, failed: false } : outcome;
  } catch (error) {
    if (error instanceof FolderToolError || error.code)
      return { text: error.message, failed: true };
    throw error;
  }
}

module.exports = { folder_tools, run_folder_tool };

/**
 * What the Docker sandbox of a self-hosted install holds. Checked by running each command in
 * the image and as the user that docker_workspace.ts starts it with. Check it again when
 * that file names another image or another user.
 */
export const docker_sandbox = {
  image: 'node:24-bookworm',
  runs_as_user: 'node',
  has: [
    'node 24 with npm and npx',
    'python3',
    'git',
    'curl',
    'wget',
    'gcc and make',
    'unzip',
    'ImageMagick (`convert`)',
  ],
  lacks: ['pip', 'a browser', 'LibreOffice', 'Pandoc', 'Poppler', 'Ghostscript', 'zip'],
  shared_python: '/workspace/.venv/bin/python',
} as const;

const python = docker_sandbox.shared_python;

/** Tells the model what its sandbox can not do on this install, and what to do in its place. */
export function build_docker_sandbox_protocol(): string {
  return [
    '## The Sandbox On This Install',
    `Your commands run in a Docker container on the owner's machine (image ${docker_sandbox.image}), as a user who is not root. \`apt-get\` and \`sudo\` do not work: never try to install a system package.`,
    `It has: ${docker_sandbox.has.join(', ')}.`,
    `It does not have: ${docker_sandbox.lacks.join(', ')}.`,
    'There is no live preview link and no browser on this install. Never start a web server for the person to open, never install a browser, never take a screenshot of a page. For a website or a page, write the files and say in one sentence that they open in the Files panel, where an HTML file renders.',
    `A chart, a spreadsheet (.xlsx), a deck (.pptx), a Word file or a PDF needs a Python library, and none is installed. Use one shared environment. If \`${python}\` does not exist, make it once: run \`python3 -m venv --without-pip /workspace/.venv\`, then \`curl -sSo tmp/get-pip.py https://bootstrap.pypa.io/get-pip.py\`, then \`${python} tmp/get-pip.py\`. Install what the job needs with \`${python} -m pip install <library>\` (pass timeout_ms 300000) and run your scripts with that python.`,
    'A skill that says the libraries are preloaded, or that tells you to render a file to an image with LibreOffice or Poppler, is wrong here: check your file by reading it back with the library.',
    'If the install of a library fails, say so and offer a file kind that needs none: CSV, Markdown, HTML, or an SVG chart. Do not promise a spreadsheet, a deck, a PDF or a chart image before its library is installed. When someone asks what you can do, say these file kinds need that one-time install first.',
  ].join('\n');
}

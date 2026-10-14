import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const app_root = join(dirname(fileURLToPath(import.meta.url)), '..');
const public_root = join(app_root, 'public');

const packages = [
  {
    name: '@extend-ai/react-docx',
    files: [
      ['dist/docx_wasm_bg.wasm', 'document-viewers/word_editor.wasm'],
      ['LICENSE', 'document-viewer-licenses/react-docx.txt'],
    ],
  },
  {
    name: '@extend-ai/react-xlsx',
    files: [
      ['dist/duke_sheets_wasm_bg.wasm', 'document-viewers/spreadsheet_viewer.wasm'],
      ['LICENSE', 'document-viewer-licenses/react-xlsx.txt'],
    ],
  },
  {
    name: 'pptx-react-viewer',
    files: [
      ['dist/pptx-viewer.css', 'pptx-react-viewer.css'],
      ['LICENSE', 'document-viewer-licenses/pptx-react-viewer.txt'],
      ['NOTICE', 'document-viewer-licenses/pptx-react-viewer-NOTICE.txt'],
    ],
  },
];

for (const viewer_package of packages) {
  const package_root = dirname(dirname(require.resolve(viewer_package.name)));
  for (const [source, destination] of viewer_package.files) {
    const output = join(public_root, destination);
    await mkdir(dirname(output), { recursive: true });
    await copyFile(join(package_root, source), output);
  }
}

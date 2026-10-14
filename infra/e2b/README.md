# E2B Sandbox Template — `coworker-workspace`

The base image every agent sandbox starts from. It bakes **tools, not files**: the agent's
own files live on the durable volume and are bind-mounted at `/workspace` when the sandbox
starts, so anything the image wrote there would be shadowed a second later.

## Where Chrome lives, and why it is not in HOME

`agent-browser` only ever looks for Chrome in `$HOME/.agent-browser/browsers`. `HOME` is now
`/tmp/coworker/home`, which is scratch and does not survive, so the image bakes Chrome into
`/opt/coworker/browser` instead and `sandbox_workspace_link_script` symlinks the cache name at
it on every session start. Both sides read `baked_browser_home` from `e2b_command.ts`, and
`verify-template.ts` fails the build if that link does not resolve to the baked copy — without
it every cold sandbox silently re-downloads ~290 MB.

## Document toolchain

The template also bakes in the tools the document skills drive from the sandbox
(`spreadsheet-files`, `document-files`, `pdf-files`, `presentation-files`):

- System: `python3`, `libreoffice`, `poppler-utils`, `pandoc`, `ghostscript`, and
  DejaVu/Liberation fonts.
- Python (installed system-wide, so `python3` finds them): `openpyxl`,
  `python-docx`, `python-pptx`, `reportlab`, `pdfplumber`, `pypdf`, `pandas`,
  `numpy`, `lxml`, `Pillow`, `pdf2image`, `tabulate`.

LibreOffice adds meaningful size and build time to the image. Rebuild the
template after changing `document_apt_packages` / `document_python_packages` in
`workspace-template.ts` — running sandboxes only pick up new libraries once the
template is rebuilt and `COWORKER_E2B_TEMPLATE_ID` points at it.

Build it with the E2B SDK runner (the CLI's `template build` is deprecated and
does not read the `Template()` definition). `E2B_API_KEY` must be set, with the key of
your own E2B account:

```bash
E2B_API_KEY=your_key bun run e2b:build-template
```

Verify the toolchain is importable at runtime (as the non-root sandbox user):

```bash
E2B_API_KEY=your_key bun run e2b:verify-template
```

Then point the runtime at the built template:

```bash
COWORKER_WORKSPACE_RUNTIME_PROVIDER=e2b
COWORKER_E2B_TEMPLATE_ID=coworker-workspace
```

`runCmd` steps run as a non-root user, so `pip3` installs use `user: 'root'` (to
reach system site-packages) and `/work` is created world-writable — otherwise the
libraries land in an unreachable per-user path and the workspace scaffold fails.

At runtime the agent edits files through `sandbox.*` tools. The runtime stores
`provider_preview_host` and `preview_port` as internal metadata. The product UI
should render a preview/proxy URL, not the raw E2B host.

import {
  type DocModel,
  DocxEditorViewer,
  initWasm,
  type OoxmlPackage,
  parseDocxForViewer,
  serializeDocx,
  useDocxEditor,
  useDocxPageLayout,
} from '@extend-ai/react-docx';
import { useEffect, useRef, useState } from 'react';
import {
  DocxPageArea,
  type DocxZoomChoice,
  DocxZoomSelect,
} from '@/components/app/workspace_documents/docx_page_zoom';
import { DocxToolbar } from '@/components/app/workspace_documents/docx_toolbar';
import { use_file_drafts } from '@/components/app/workspace_documents/file_drafts';
import {
  OfficePreviewError,
  OfficePreviewLoading,
} from '@/components/app/workspace_documents/office_preview_status';

const docx_wasm_path = '/document-viewers/word_editor.wasm';
const docx_wasm_timeout_ms = 15_000;
let docx_wasm_promise: Promise<void> | null = null;

function load_docx_wasm() {
  if (docx_wasm_promise) return docx_wasm_promise;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), docx_wasm_timeout_ms);
  const promise = fetch(docx_wasm_path, { signal: controller.signal })
    .then((response) => {
      if (!response.ok) throw new Error(`Word editor setup failed (${response.status}).`);
      return response.arrayBuffer();
    })
    .then((bytes) => initWasm(bytes))
    .then(() => undefined)
    .catch((error: unknown) => {
      docx_wasm_promise = null;
      throw new Error(
        'The Word editor could not load. Check your connection and reopen the file.',
        {
          cause: error,
        },
      );
    })
    .finally(() => window.clearTimeout(timeout));
  docx_wasm_promise = promise;
  return promise;
}

type DocxDraft = {
  dirty: boolean;
  editor_generation: number;
  model: DocModel;
  package: OoxmlPackage;
  source_bytes: ArrayBuffer;
};

const docx_drafts = new Map<string, DocxDraft>();

export type DocxDocumentProps = {
  bytes: ArrayBuffer;
  file_name: string;
  editable: boolean;
  draft_key?: string;
  editor_generation?: number;
  onDirtyChange: (dirty: boolean) => void;
  onRegisterSave: (save: (() => Promise<Uint8Array>) | null) => void;
};

export function DocxDocument(props: DocxDocumentProps) {
  const [document, set_document] = useState<DocxDraft | null>(null);
  const [error, set_error] = useState<string | null>(null);

  useEffect(() => {
    if (props.bytes.byteLength > 25 * 1024 * 1024) return;
    let active = true;
    set_error(null);
    void load_docx_wasm()
      .then(() => {
        if (!active) return null;
        const cached = props.draft_key ? docx_drafts.get(props.draft_key) : undefined;
        if (
          cached &&
          cached.editor_generation === (props.editor_generation ?? 0) &&
          ((props.editable && cached.dirty) || cached.source_bytes === props.bytes)
        ) {
          set_document(cached);
          return null;
        }
        set_document(null);
        return parseDocxForViewer(props.bytes.slice(0), {
          fileName: props.file_name,
          loadEmbeddedFonts: true,
          useWorker: 'required',
        });
      })
      .then((parsed) => {
        if (!active || !parsed) return;
        const { model, package: docx_package } = parsed;
        const next = {
          dirty: false,
          model,
          package: docx_package,
          source_bytes: props.bytes,
          editor_generation: props.editor_generation ?? 0,
        };
        if (props.draft_key) docx_drafts.set(props.draft_key, next);
        set_document(next);
      })
      .catch((load_error: unknown) => {
        if (active) set_error(error_message(load_error, 'This Word document could not open.'));
      });
    return () => {
      active = false;
    };
  }, [props.bytes, props.draft_key, props.editor_generation, props.file_name, props.editable]);

  if (props.bytes.byteLength > 25 * 1024 * 1024) {
    return <OfficePreviewError message="This Word document exceeds the 25 MB limit." />;
  }
  if (error) return <OfficePreviewError message={error} />;
  if (!document) return <OfficePreviewLoading label="Opening Word document..." />;
  return (
    <DocxEditor
      key={`${props.draft_key ?? props.file_name}:${props.editor_generation ?? 0}`}
      document={document}
      {...props}
    />
  );
}

function DocxEditor({ document, ...props }: DocxDocumentProps & { document: DocxDraft }) {
  const editor = useDocxEditor({ initialFileName: props.file_name, starterModel: document.model });
  const initial_model = useRef(editor.model);
  const page_width_px = useDocxPageLayout(editor).layout.pageWidthPx;
  const [zoom_choice, set_zoom_choice] = useState<DocxZoomChoice>('fit');
  const [export_error, set_export_error] = useState<string | null>(null);

  useEffect(() => {
    if (!props.editable || editor.model === initial_model.current) return;
    if (props.draft_key) {
      docx_drafts.set(props.draft_key, { ...document, dirty: true, model: editor.model });
    }
    props.onDirtyChange(true);
  }, [document, editor.model, props.draft_key, props.editable, props.onDirtyChange]);

  useEffect(
    () => () => {
      if (!props.draft_key) return;
      const stored_draft = use_file_drafts.getState().drafts[props.draft_key];
      if (!stored_draft?.dirty) docx_drafts.delete(props.draft_key);
    },
    [props.draft_key],
  );

  useEffect(() => {
    props.onRegisterSave(async () => {
      try {
        set_export_error(null);
        return new Uint8Array(await serializeDocx(editor.model, document.package));
      } catch (save_error) {
        set_export_error(error_message(save_error, 'This Word document could not save.'));
        throw save_error;
      }
    });
    return () => props.onRegisterSave(null);
  }, [document.package, editor.model, props.onRegisterSave]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-sunken">
      <DocxToolbar editor={editor} editable={props.editable} />
      {export_error ? (
        <div className="border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {export_error}
        </div>
      ) : null}
      <DocxPageArea page_width_px={page_width_px} zoom_choice={zoom_choice}>
        <DocxEditorViewer
          editor={editor}
          mode={props.editable ? 'edit' : 'read-only'}
          pageBackgroundColor="#ffffff"
          pageGapBackgroundColor="transparent"
        />
      </DocxPageArea>
      <div className="flex h-8 shrink-0 items-center justify-between border-t border-border bg-background px-3 text-xs text-muted-foreground">
        <span className="tabular-nums">
          Page {editor.currentPage} of {editor.totalPages}
        </span>
        <DocxZoomSelect zoom_choice={zoom_choice} onChange={set_zoom_choice} />
      </div>
    </div>
  );
}

function error_message(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

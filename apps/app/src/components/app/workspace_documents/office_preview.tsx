import { useEffect } from 'react';
import {
  OfficePreviewError,
  OfficePreviewLoading,
} from '@/components/app/workspace_documents/office_preview_status';
import { client_only_lazy } from '@/components/client_only_lazy';

const loading_preview = () => <OfficePreviewLoading label="Opening document..." />;

const DocxDocument = client_only_lazy(
  async () => ({
    default: (await import('@/components/app/workspace_documents/docx_editor')).DocxDocument,
  }),
  loading_preview(),
);
const PowerpointPreview = client_only_lazy(
  async () => ({
    default: (await import('@/components/app/workspace_documents/powerpoint_preview'))
      .PowerpointPreview,
  }),
  loading_preview(),
);
const SpreadsheetPreview = client_only_lazy(
  async () => ({
    default: (await import('@/components/app/workspace_documents/spreadsheet_preview'))
      .SpreadsheetPreview,
  }),
  loading_preview(),
);

export type OfficePreviewProps = {
  bytes: ArrayBuffer;
  file_name: string;
  editable: boolean;
  draft_key?: string;
  editor_generation?: number;
  onDirtyChange: (dirty: boolean) => void;
  onRegisterSave: (save: (() => Promise<Uint8Array>) | null) => void;
};

export function OfficePreview(props: OfficePreviewProps) {
  const extension = props.file_name.split('.').pop()?.toLowerCase();
  if (extension === 'docx') return <DocxDocument {...props} />;
  if (extension === 'pptx')
    return (
      <ReadOnlyPreviewRegistration {...props}>
        <PowerpointPreview bytes={props.bytes} file_name={props.file_name} />
      </ReadOnlyPreviewRegistration>
    );
  if (extension === 'xlsx' || extension === 'xls')
    return (
      <ReadOnlyPreviewRegistration {...props}>
        <SpreadsheetPreview bytes={props.bytes} file_name={props.file_name} />
      </ReadOnlyPreviewRegistration>
    );
  return <OfficePreviewError message="This Office document format is not supported." />;
}

function ReadOnlyPreviewRegistration({
  children,
  onDirtyChange,
  onRegisterSave,
}: Pick<OfficePreviewProps, 'onDirtyChange' | 'onRegisterSave'> & { children: React.ReactNode }) {
  useEffect(() => {
    onDirtyChange(false);
    onRegisterSave(null);
    return () => onRegisterSave(null);
  }, [onDirtyChange, onRegisterSave]);
  return children;
}

export {
  OfficePreviewError,
  OfficePreviewLoading,
} from '@/components/app/workspace_documents/office_preview_status';

import { setWasmSource, XlsxViewer } from '@extend-ai/react-xlsx';
import { useTheme } from 'next-themes';
import {
  OfficePreviewError,
  OfficePreviewLoading,
} from '@/components/app/workspace_documents/office_preview_status';

const spreadsheet_wasm_path = '/document-viewers/spreadsheet_viewer.wasm';
const full_address_the_viewer_worker_can_fetch = new URL(
  spreadsheet_wasm_path,
  window.location.origin,
);

setWasmSource(full_address_the_viewer_worker_can_fetch);

export type SpreadsheetPreviewProps = {
  bytes: ArrayBuffer;
  file_name: string;
};

export function SpreadsheetPreview({ bytes, file_name }: SpreadsheetPreviewProps) {
  const { resolvedTheme } = useTheme();
  return (
    <div className="h-full min-h-0 overflow-hidden bg-background">
      <XlsxViewer
        className="h-full min-h-0 w-full"
        errorState={(error) => <OfficePreviewError message={error.message} />}
        file={bytes}
        fileName={file_name}
        fileTooLargeState={() => (
          <OfficePreviewError message="This spreadsheet exceeds the 25 MB preview limit." />
        )}
        height="100%"
        isDark={resolvedTheme === 'dark'}
        loadingState={<OfficePreviewLoading label="Opening spreadsheet..." />}
        maxFileSizeBytes={25 * 1024 * 1024}
        readOnly={true}
        showDefaultToolbar={true}
      />
    </div>
  );
}

import { Button } from '@coworker/ui/components/button';
import { Download } from 'lucide-react';
import { workspace_file_download_url } from '@/lib/api';

function download_name(file_path: string) {
  return file_path.split('/').pop() ?? 'file';
}

/**
 * The two download links of a workspace file. The link element has no children of its own: a
 * button takes the children of the element it is drawn as, and that left the icon out.
 */
export function FileDownloadIconLink({ file_path }: { file_path: string }) {
  return (
    <Button
      title="Download file"
      size="icon-sm"
      variant="ghost"
      render={
        // biome-ignore lint/a11y/useAnchorContent: the button puts the icon in, and the label names it
        <a
          aria-label="Download file"
          href={workspace_file_download_url(file_path)}
          download={download_name(file_path)}
        />
      }
    >
      <Download className="size-4" />
    </Button>
  );
}

export function FileDownloadLink({ file_path }: { file_path: string }) {
  return (
    <Button
      size="sm"
      render={
        // biome-ignore lint/a11y/useAnchorContent: the button puts the icon and the words in
        <a href={workspace_file_download_url(file_path)} download={download_name(file_path)} />
      }
    >
      <Download className="size-4" />
      Download file
    </Button>
  );
}

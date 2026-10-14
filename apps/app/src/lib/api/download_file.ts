import { api_client, read_api_data } from '@/lib/api/client';

type FileDownload = {
  file_id: string;
  file_name: string;
  mime_type: string;
  download_url: string;
};

export async function download_file(file_id: string) {
  const response = await api_client.v1.files[':file_id'].download.$get({ param: { file_id } });
  const download = await read_api_data<FileDownload>(response, {
    method: 'GET',
    path: `/v1/files/${file_id}/download`,
  });

  // A link click rather than window.open: a popup blocker treats a programmatic open as a
  // popup, and this is a download the person just asked for.
  const link = document.createElement('a');
  link.href = download.download_url;
  link.download = download.file_name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  return download;
}

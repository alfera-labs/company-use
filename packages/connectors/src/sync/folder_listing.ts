import { write_input_path } from '@connectors/sync/list_request';
import { page_cursor_to_send } from '@connectors/sync/page_cursor';
import type { ConnectorFolderListing } from '@connectors/sync/record_path_types';

export function build_folder_listing_input(
  listing: ConnectorFolderListing,
  page_cursor: string | null,
): Record<string, unknown> {
  const input = structuredClone(listing.input ?? {});
  const { page } = listing;
  if (page.cursor_param) {
    write_input_path(input, page.cursor_param, page_cursor_to_send(page, page_cursor ?? undefined));
  }
  if (page.page_size_param) write_input_path(input, page.page_size_param, page.page_size);
  return input;
}

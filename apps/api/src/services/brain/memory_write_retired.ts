import { not_in_this_edition_error } from '@api/lib/not_in_this_edition';

export function refuse_memory_write(): never {
  throw not_in_this_edition_error();
}

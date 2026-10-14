import { ValidationError } from '@coworker/shared';
import { z } from 'zod';

export type SessionPageOrder = 'asc' | 'desc';
type PageDirection = 'next' | 'prev';

export type PageCursor = {
  created_time: Date;
  session_id: string;
  order: SessionPageOrder;
  direction: PageDirection;
};

const cursor_schema = z.strictObject({
  v: z.literal(1),
  t: z.iso.datetime({ offset: true }),
  id: z.string().min(1),
  order: z.enum(['asc', 'desc']),
  direction: z.enum(['next', 'prev']),
});

export function encode_page_cursor(cursor: PageCursor): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      t: cursor.created_time.toISOString(),
      id: cursor.session_id,
      order: cursor.order,
      direction: cursor.direction,
    }),
  ).toString('base64url');
}

export function decode_page_cursor(page: string): PageCursor {
  const decoded = read_json(page);
  const parsed = cursor_schema.safeParse(decoded);
  if (!parsed.success) throw new ValidationError('The page cursor is not one this API issued');
  return {
    created_time: new Date(parsed.data.t),
    session_id: parsed.data.id,
    order: parsed.data.order,
    direction: parsed.data.direction,
  };
}

function read_json(page: string): unknown {
  try {
    return JSON.parse(Buffer.from(page, 'base64url').toString('utf8'));
  } catch {
    throw new ValidationError('The page cursor is not one this API issued');
  }
}

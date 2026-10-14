import { timingSafeEqual } from 'node:crypto';

export function secure_strings_equal(left: string, right: string) {
  const left_buffer = Buffer.from(left);
  const right_buffer = Buffer.from(right);
  return left_buffer.length === right_buffer.length && timingSafeEqual(left_buffer, right_buffer);
}

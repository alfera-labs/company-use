import { toast } from 'sonner';
import type { ChatWallCode } from '@/components/app/use_chat_paywall';
import { ApiError } from '@/lib/api/client';

/** Tells the person why a message did not start: the paywall, a busy chat, or the error. */
export function show_send_error(error: Error, set_wall_code: (code: ChatWallCode) => void) {
  if (
    error instanceof ApiError &&
    (error.code === 'card_required' || error.code === 'out_of_credits')
  ) {
    set_wall_code(error.code);
    return;
  }
  if (error instanceof ApiError && (error.code === 'conflict' || error.code === 'session_busy')) {
    toast.message(error.message);
    return;
  }
  toast.error(error instanceof Error ? error.message : 'The run could not be completed.');
}

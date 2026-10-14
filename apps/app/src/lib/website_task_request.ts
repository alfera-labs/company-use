import { public_env } from '@coworker/config/public_env';
import { new_chat_draft_key } from '@/components/app/chat_draft_storage';
import { useChatDraftStore } from '@/components/app/chat_draft_store';

export const new_chat_path = '/chats';

export function build_website_task_request(website_name: string): string {
  const name = website_name.trim();
  return `Use the ${name} website for me. Open it in the browser, then tell me what you can do there.`;
}

/**
 * Starts a browser job on a website: put the request in the new chat's composer and
 * hand back the route the caller opens. Nothing here claims a browser session
 * already exists, and nothing is sent until the person presses send.
 *
 * The integrations page and, later, onboarding start the same job through this one
 * function, so both write the same words to the same place.
 */
export function start_website_task(website_name: string): string {
  useChatDraftStore
    .getState()
    .set_draft(new_chat_draft_key, build_website_task_request(website_name));
  return new_chat_path;
}

export function website_browsing_guide_url(): string {
  return new URL('/product/browser', public_env.NEXT_PUBLIC_MARKETING_URL).toString();
}

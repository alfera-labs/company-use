import { Users } from 'lucide-react';
import { use_team_viewer_role } from '@/components/app/use_team_mode';

/**
 * Stays on the row of a chat that is in a project other people read, so its place shows
 * without a hover. It is drawn only where several people sign in to one install: there a chat
 * is private until it is moved, and the mark is how a person sees that one is not.
 */
export function SharedChatMark({ project_label }: { project_label: string | undefined }) {
  const chats_are_private_by_default = use_team_viewer_role() !== null;
  if (!chats_are_private_by_default || !project_label) return null;
  const words = `Everyone in ${project_label} can read this chat`;
  return (
    <span role="img" aria-label={words} title={words} className="shrink-0 text-muted-foreground">
      <Users aria-hidden="true" className="size-3" />
    </span>
  );
}

import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@coworker/ui/components/dropdown-menu';
import { Check } from 'lucide-react';
import { project_is_ticked } from '@/components/app/connection_audience';
import type { ResourceSharing } from '@/lib/api/endpoints';
import type { Project } from '@/lib/api/types';

export function AudienceChoice({
  checked,
  label,
  onPick,
}: {
  checked: boolean;
  label: string;
  onPick: () => void;
}) {
  return (
    <DropdownMenuItem onClick={onPick}>
      <span className="flex-1 truncate">{label}</span>
      {checked ? <Check className="size-4" /> : null}
    </DropdownMenuItem>
  );
}

export function project_choice_label(room: Project, current_project_id?: string) {
  return room.project_id === current_project_id
    ? `${room.project_name} (this project)`
    : room.project_name;
}

export function AudienceProjectChoices({
  current_project_id,
  rooms,
  sharing,
  onPick,
}: {
  current_project_id?: string | undefined;
  rooms: readonly Project[];
  sharing: ResourceSharing;
  onPick: (project_id: string) => void;
}) {
  if (rooms.length === 0) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Or only in these projects</DropdownMenuLabel>
      {rooms.map((room) => (
        <AudienceChoice
          checked={project_is_ticked(sharing, room.project_id)}
          key={room.project_id}
          label={project_choice_label(room, current_project_id)}
          onPick={() => onPick(room.project_id)}
        />
      ))}
    </>
  );
}

export function OwnChatsNote({ shown }: { shown: boolean }) {
  if (!shown) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Always works in your own chats</DropdownMenuLabel>
    </>
  );
}

import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubmenu,
  DropdownMenuSubmenuTrigger,
} from '@coworker/ui/components/dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { member_name, type replacing } from '@/components/app/connection_audience';
import { person_is_ticked, read_person_tick } from '@/components/app/connection_audience_people';
import type { ResourceSharing, WorkspaceMember } from '@/lib/api/endpoints';

export function AudiencePeopleSubmenu({
  members,
  sharing,
  onSave,
  onOpenToEveryone,
}: {
  members: readonly WorkspaceMember[];
  sharing: ResourceSharing;
  onSave: (body: ReturnType<typeof replacing>) => void;
  onOpenToEveryone: () => void;
}) {
  if (members.length === 0) return null;

  function pick_person(person_id: string) {
    const tick = read_person_tick(sharing, person_id);
    if ('refuse' in tick) return toast.error(tick.refuse);
    if ('ask' in tick) return onOpenToEveryone();
    onSave(tick.save);
  }

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuSubmenu>
        <DropdownMenuSubmenuTrigger>
          <span className="flex-1">Or only these people</span>
          <ChevronRight className="ml-auto" />
        </DropdownMenuSubmenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-72 min-w-56 overflow-y-auto"
          side="right"
          sideOffset={4}
        >
          {members.map((member) => (
            <DropdownMenuItem
              closeOnClick={false}
              key={member.user_id}
              onClick={() => pick_person(member.user_id)}
            >
              <span className="flex-1 truncate">{member_name(member)}</span>
              {person_is_ticked(sharing, member.user_id) ? <Check className="size-4" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenuSubmenu>
    </>
  );
}

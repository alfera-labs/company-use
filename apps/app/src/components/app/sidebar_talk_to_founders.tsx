import { founder_first_name, founder_phone } from '@coworker/config/founder_contact';
import { sidebar_menu_item_class_name, useSidebar } from '@coworker/ui/components/sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@coworker/ui/components/tooltip';
import { MessageCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth_client';

export function SidebarTalkToFounders() {
  const { user } = useAuth();
  const { collapsed } = useSidebar();
  const first_name = user?.firstName?.trim();
  const intro = first_name
    ? `Hey ${founder_first_name}! I'm ${first_name} and I have just signed up on Alfera.`
    : `Hey ${founder_first_name}! I have just signed up on Alfera.`;
  const sms_href = `sms:${founder_phone}&body=${encodeURIComponent(intro)}`;
  if (!founder_phone) return null;

  const link = (
    <a href={sms_href} aria-label="Talk to founders" className={sidebar_menu_item_class_name}>
      <MessageCircle />
      <span className="truncate">Talk to founders</span>
    </a>
  );

  if (!collapsed) return link;

  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right">Talk to founders</TooltipContent>
    </Tooltip>
  );
}

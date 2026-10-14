import { public_env } from '@coworker/config/public_env';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@coworker/ui/components/sheet';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@coworker/ui/components/sidebar';
import { Switch } from '@coworker/ui/components/switch';
import { SlidersHorizontal } from 'lucide-react';
import { useChatUiStore } from '@/components/app/chat_ui_store';
import { DevSettingsTrialSection } from '@/components/app/dev_settings_trial_section';

export const dev_settings_available = public_env.NEXT_PUBLIC_ENVIRONMENT !== 'production';

export function DevSettings() {
  const show_full_traces = useChatUiStore((state) => state.show_full_traces);
  const set_show_full_traces = useChatUiStore((state) => state.set_show_full_traces);

  if (!dev_settings_available) return null;

  return (
    <Sheet>
      <SidebarMenu>
        <SidebarMenuItem>
          <SheetTrigger render={<SidebarMenuButton aria-label="Dev Settings" />}>
            <SlidersHorizontal />
            <span>Dev settings</span>
          </SheetTrigger>
        </SidebarMenuItem>
      </SidebarMenu>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Dev Settings</SheetTitle>
          <SheetDescription>Change development tools for the current workspace.</SheetDescription>
        </SheetHeader>

        <div className="space-y-6 p-6">
          <section className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-sm">Show full traces</p>
              <p className="text-muted-foreground text-sm">
                Show every trace step in chat conversations.
              </p>
            </div>
            <Switch
              aria-label="Show full traces"
              checked={show_full_traces}
              onCheckedChange={set_show_full_traces}
            />
          </section>

          <DevSettingsTrialSection />
        </div>
      </SheetContent>
    </Sheet>
  );
}

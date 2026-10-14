import { SegmentedControl, SegmentedControlItem } from '@coworker/ui/components/segmented-control';
import { SettingsRow } from '@coworker/ui/components/settings-card';
import { Bell, BellOff } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import {
  read_desktop_notifications_enabled,
  write_desktop_notifications_enabled,
} from '@/components/app/desktop_notification_storage';
import {
  type DesktopNotificationPermission,
  read_desktop_notification_permission,
  request_desktop_notification_permission,
} from '@/components/app/desktop_notifications';

export function DesktopNotificationSettings() {
  const [is_enabled, set_is_enabled] = useState(false);
  const [permission, set_permission] = useState<DesktopNotificationPermission>('unsupported');
  // The stored preference and the browser permission are only readable in the browser, so the
  // first paint has to be the server's neutral state or hydration mismatches.
  const [is_mounted, set_is_mounted] = useState(false);

  useEffect(() => {
    set_is_mounted(true);
    set_is_enabled(read_desktop_notifications_enabled());
    set_permission(read_desktop_notification_permission());
  }, []);

  async function turn_notifications_on() {
    const granted_permission = await request_desktop_notification_permission();
    set_permission(granted_permission);
    if (granted_permission !== 'granted') return;
    set_is_enabled(true);
    write_desktop_notifications_enabled(true);
  }

  function turn_notifications_off() {
    set_is_enabled(false);
    write_desktop_notifications_enabled(false);
  }

  if (!is_mounted) return <NotificationRow description="Checking this browser…" />;

  const blocked_because = reasons_notifications_cannot_work[permission];
  if (blocked_because) return <NotificationRow description={blocked_because} />;

  return (
    <NotificationRow description={describe_notification_state(permission, is_enabled)}>
      <SegmentedControl
        aria-label="Notifications"
        value={is_enabled ? 'on' : 'off'}
        onValueChange={(value) =>
          value === 'on' ? void turn_notifications_on() : turn_notifications_off()
        }
      >
        <SegmentedControlItem value="on">
          <Bell />
          On
        </SegmentedControlItem>
        <SegmentedControlItem value="off">
          <BellOff />
          Off
        </SegmentedControlItem>
      </SegmentedControl>
    </NotificationRow>
  );
}

function NotificationRow({ description, children }: { description: string; children?: ReactNode }) {
  return (
    <SettingsRow title="Notifications" description={description}>
      {children}
    </SettingsRow>
  );
}

const reasons_notifications_cannot_work: Partial<Record<DesktopNotificationPermission, string>> = {
  unsupported: 'This browser cannot show notifications.',
  needs_https:
    'Notifications need https. This page is on plain http, so the browser does not offer them.',
};

function describe_notification_state(
  permission: DesktopNotificationPermission,
  is_enabled: boolean,
) {
  if (permission === 'denied') {
    return 'This browser is blocking notifications. Allow them for this site in your browser settings, then turn this on.';
  }
  if (is_enabled) return 'You will get a notification when a chat finishes working.';
  return 'Turn this on to be told when a chat finishes while you are somewhere else.';
}

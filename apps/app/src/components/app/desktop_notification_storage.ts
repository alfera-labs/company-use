const desktop_notification_storage_key = 'coworker-desktop-notifications-enabled';

export function read_desktop_notifications_enabled() {
  if (typeof window === 'undefined') return false;

  try {
    return window.localStorage.getItem(desktop_notification_storage_key) === 'true';
  } catch (error) {
    console.error('Could not read the desktop notification preference.', error);
    return false;
  }
}

export function write_desktop_notifications_enabled(is_enabled: boolean) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(desktop_notification_storage_key, String(is_enabled));
  } catch (error) {
    console.error('Could not save the desktop notification preference.', error);
  }
}

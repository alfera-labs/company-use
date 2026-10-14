export type DesktopNotificationPermission =
  | 'unsupported'
  | 'needs_https'
  | 'default'
  | 'granted'
  | 'denied';

/**
 * A browser shows notifications only on https and on localhost. On plain http it answers
 * 'denied' and no browser setting changes that, so the page says the real reason instead.
 */
export function read_desktop_notification_permission(): DesktopNotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  if (!window.isSecureContext) return 'needs_https';
  return window.Notification.permission;
}

// The browser only accepts this from a user gesture, so it is called from the settings toggle
// and never on page load. Returns the permission the browser settled on, which is 'denied'
// when the person refuses — a state the UI has to show, because from then on nothing this
// app does can raise a notification and only browser settings can undo it.
export async function request_desktop_notification_permission(): Promise<DesktopNotificationPermission> {
  const permission = read_desktop_notification_permission();
  if (permission !== 'default') return permission;

  try {
    return await window.Notification.requestPermission();
  } catch (error) {
    console.error('The browser refused the notification permission prompt.', error);
    return read_desktop_notification_permission();
  }
}

// `tag` collapses repeats: a chat that finishes, gets a follow-up, and finishes again replaces
// its own notification instead of stacking a second one for the same chat.
export function show_desktop_notification(input: {
  title: string;
  body: string;
  tag: string;
  on_click: () => void;
}) {
  if (read_desktop_notification_permission() !== 'granted') return;

  try {
    const notification = new window.Notification(input.title, {
      body: input.body,
      tag: input.tag,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
      input.on_click();
    };
  } catch (error) {
    // Some browsers throw here rather than resolving the permission, and a notification is
    // never worth breaking the page over.
    console.error('The browser could not show a desktop notification.', error);
  }
}

// The widget theme sheets are imported here, with the only component that renders them,
// so they ship on /settings alone. Order matters: Radix Themes defines the scales the
// widget sheets read, and `workos_widgets.css` repoints those scales at the app's own
// tokens, so it has to come last.
import '@radix-ui/themes/styles.css';
import '@workos-inc/widgets/base.css';
import '@workos-inc/widgets/styles.css';
import '@/components/app/workos_widgets.css';
import { UserProfile, WorkOsWidgets } from '@workos-inc/widgets';
import { useTheme } from 'next-themes';
import { type ReactNode, useEffect, useState } from 'react';
import { EmptyNote } from '@/components/app/empty_note';

type WorkosWidgetApiOrigin = {
  apiHostname: string;
  port: number | null;
  https: boolean;
};

export function WorkosProfilePanel({ authToken }: { authToken: string }) {
  return (
    <WorkosWidgetFrame>
      <UserProfile authToken={authToken} />
    </WorkosWidgetFrame>
  );
}

function WorkosWidgetFrame({ children }: { children: ReactNode }) {
  const api_origin = useWorkosWidgetApiOrigin();
  const appearance = useWorkosWidgetAppearance();
  if (!api_origin) return <EmptyNote>Loading WorkOS settings…</EmptyNote>;

  return (
    <WorkOsWidgets
      className="coworker-workos-widget-root"
      apiHostname={api_origin.apiHostname}
      port={api_origin.port}
      https={api_origin.https}
      theme={{
        appearance,
        accentColor: 'orange',
        grayColor: 'gray',
        radius: 'large',
        panelBackground: 'solid',
        fontFamily: 'var(--font-sans-stack)',
      }}
    >
      {children}
    </WorkOsWidgets>
  );
}

function useWorkosWidgetAppearance(): 'light' | 'dark' {
  const { resolvedTheme } = useTheme();
  const [appearance, set_appearance] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    set_appearance(resolvedTheme === 'dark' ? 'dark' : 'light');
  }, [resolvedTheme]);

  return appearance;
}

function useWorkosWidgetApiOrigin() {
  const [api_origin, set_api_origin] = useState<WorkosWidgetApiOrigin | null>(null);

  useEffect(() => {
    set_api_origin({
      apiHostname: window.location.hostname,
      port: window.location.port ? Number(window.location.port) : null,
      https: window.location.protocol === 'https:',
    });
  }, []);

  return api_origin;
}

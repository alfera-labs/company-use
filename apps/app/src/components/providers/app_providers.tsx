import { TooltipProvider } from '@coworker/ui/components/tooltip';
import { useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { PostHogIdentity } from '@/components/providers/posthog_identity';
import { QueryProvider } from '@/components/providers/query_provider';
import { ThemeProvider } from '@/components/providers/theme_provider';
import { AttributionCapture } from '@/components/tracking/attribution-capture';
import { AppAuthProvider } from '@/lib/auth_client';
import { is_product_demo_path } from '@/lib/product_demo_path';

export function AppProviders({ children }: { children: ReactNode }) {
  const is_demo = useLocation({ select: (location) => is_product_demo_path(location.pathname) });
  const presentation = (
    <ThemeProvider {...(is_demo ? { forcedTheme: 'light' } : {})}>
      <QueryProvider>
        <TooltipProvider>
          {children}
          <Toaster position="bottom-right" richColors closeButton />
        </TooltipProvider>
      </QueryProvider>
    </ThemeProvider>
  );
  if (is_demo) return presentation;
  return (
    <AppAuthProvider>
      <AttributionCapture />
      <PostHogIdentity />
      {presentation}
    </AppAuthProvider>
  );
}

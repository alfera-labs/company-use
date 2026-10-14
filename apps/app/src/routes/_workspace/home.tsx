import { Skeleton } from '@coworker/ui/components/skeleton';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { HomeChatSurface } from '@/components/app/home_chat_surface';
import { page_title } from '@/lib/page_title';

export const Route = createFileRoute('/_workspace/home')({
  validateSearch: z.object({ prompt: z.string().optional() }),
  head: () => ({ meta: [{ title: page_title('Home') }] }),
  component: HomeChatSurface,
  pendingComponent: HomeLoading,
});

function HomeLoading() {
  return (
    <section className="relative flex h-dvh flex-col items-center justify-end bg-background text-foreground md:justify-center">
      <div className="mx-auto w-full max-w-3xl px-4 md:px-0">
        <h1 className="mb-6 text-balance text-center text-3xl font-medium">
          What should Alfera get done?
        </h1>
        <Skeleton className="h-32 w-full rounded-3xl" />
      </div>
    </section>
  );
}

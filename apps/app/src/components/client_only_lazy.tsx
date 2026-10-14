import { ClientOnly } from '@tanstack/react-router';
import { type ComponentType, lazy, type ReactNode, Suspense } from 'react';

export function client_only_lazy<TProps extends object>(
  load: () => Promise<{ default: ComponentType<TProps> }>,
  fallback?: ReactNode,
): ComponentType<TProps> {
  const Loaded = lazy(load);
  return function ClientOnlyLazy(props: TProps) {
    return (
      <ClientOnly fallback={fallback}>
        <Suspense fallback={fallback}>
          <Loaded {...props} />
        </Suspense>
      </ClientOnly>
    );
  };
}

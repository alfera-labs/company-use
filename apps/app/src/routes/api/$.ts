import { createFileRoute } from '@tanstack/react-router';
import { proxy_to_api } from '@/lib/api_proxy';

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      ANY: ({ request }) => proxy_to_api(request),
    },
  },
});

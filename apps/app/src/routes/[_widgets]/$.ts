// This route lives in a folder named `[_widgets]`: the brackets escape the leading underscore,
// which would otherwise mark the segment as a pathless layout and drop it from the URL. The
// public path is /_widgets/..., which the WorkOS widgets SDK addresses directly. Do not rename it.
import { createFileRoute } from '@tanstack/react-router';
import { read_workos_auth } from '@/lib/workos_session';
import {
  build_workos_widget_response_headers,
  build_workos_widget_upstream_url,
  forward_workos_widget_headers,
} from '@/lib/workos_widget_proxy';

export const Route = createFileRoute('/_widgets/$')({
  server: {
    handlers: {
      ANY: ({ request, params }) => proxy_workos_widget_request(request, params._splat ?? ''),
    },
  },
});

async function proxy_workos_widget_request(request: Request, splat: string) {
  const auth = await read_workos_auth();
  if (!auth.user) {
    return Response.json(
      { error: { code: 'unauthorized', message: 'Sign in to use WorkOS widgets' } },
      { status: 401 },
    );
  }

  const path = splat.split('/').filter(Boolean);
  let upstream_url: string;
  try {
    upstream_url = build_workos_widget_upstream_url(request.url, ['_widgets', ...path]);
  } catch {
    return Response.json(
      { error: { code: 'invalid_path', message: 'Invalid WorkOS widget path' } },
      { status: 400 },
    );
  }
  const has_body = request.method !== 'GET' && request.method !== 'HEAD';
  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers: forward_workos_widget_headers(request.headers),
    redirect: 'manual',
    cache: 'no-store',
    ...(has_body ? { body: request.body, duplex: 'half' } : {}),
  };

  const upstream = await fetch(upstream_url, init);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: build_workos_widget_response_headers(upstream.headers),
  });
}

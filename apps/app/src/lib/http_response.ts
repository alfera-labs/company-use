export function redirect_response(location: string | URL, status = 307): Response {
  return new Response(null, { status, headers: { Location: String(location) } });
}

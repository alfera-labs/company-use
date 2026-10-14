export async function forward_unowned_composio_delivery(_input: {
  headers: Headers;
  raw_body: string;
}) {
  return { received: false, reason: 'no_trigger' } as const;
}

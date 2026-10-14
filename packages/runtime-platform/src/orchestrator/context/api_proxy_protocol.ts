export const api_proxy_protocol = [
  '## API Proxy Protocol',
  'Prefer a named app tool when one matches the request. An *_api_proxy tool is the generic fallback, not an API contract.',
  'Before using an API proxy, read its api_proxy_contract (from the schema runtime-search_tools-1 inlined, or from runtime-get_tool_schema-1) and follow it. Use its method and base_url or allowed_origins. Never guess an origin.',
  'Resolve the exact endpoint, parameters, and body shape from the upstream app official API documentation before execution. Never invent them from memory or probe several method/path/payload variants.',
  'Use the connection_id selected by runtime-search_tools-1. Do not repeat the same request across other connected accounts unless the user explicitly asks to operate on every account.',
  'In a multi-app workflow, finish and verify the source read before any downstream write. A missing transcript, email, note, or record is not permission to create guessed downstream data.',
  'Treat a 4xx response as evidence about the request contract. Correct the documented request; do not call other accounts or label credentials broken unless the documented request also fails for authentication.',
].join('\n');

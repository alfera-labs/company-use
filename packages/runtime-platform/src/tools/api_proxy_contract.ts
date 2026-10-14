import { is_api_proxy_runtime_handler } from '@coworker/core/integrations/provider_runtime_handlers';

type ApiProxyCatalogTool = {
  runtime_handler: string;
  node_config: {
    proxy?: {
      method?: string | null;
      url_mode?: string | null;
      base_proxy_target_url?: string | null;
    };
  };
  allowed_request_origins: readonly string[];
};

export function build_api_proxy_contract(tool: ApiProxyCatalogTool) {
  if (!is_api_proxy_runtime_handler(tool.runtime_handler)) return null;

  const proxy = tool.node_config.proxy;
  const base_url = parse_static_base_url(proxy?.base_proxy_target_url);
  return {
    method: proxy?.method ?? null,
    url_mode: proxy?.url_mode ?? null,
    ...(base_url ? { base_url } : {}),
    allowed_origins: tool.allowed_request_origins,
    endpoint_source: 'official_api_documentation_required',
  };
}

function parse_static_base_url(candidate: string | null | undefined) {
  if (!candidate || candidate.includes('{{') || candidate.includes('${')) return null;

  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

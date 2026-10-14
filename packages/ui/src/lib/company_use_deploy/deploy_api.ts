export const deploy_api_address = (api_origin: string, path: string) =>
  `${api_origin.replace(/\/+$/, '')}/v1/company-use/deploy/${path}`;

export function post_to_deploy_api(api_origin: string, path: string, body: unknown) {
  return fetch(deploy_api_address(api_origin, path), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

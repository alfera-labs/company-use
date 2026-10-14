import {
  type TestOverrides,
  test_overrides_schema,
} from '@coworker/ui/lib/company_use_deploy/deploy_session';

const fragment_name = 'e2e';
export const test_resource_prefix = 'alfera-e2e';

function decode_base64url(text: string) {
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/');
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (letter) => letter.charCodeAt(0)));
}

export function take_test_overrides_from_the_address(is_allowed: boolean): TestOverrides | null {
  const encoded = new URLSearchParams(window.location.hash.slice(1)).get(fragment_name);
  if (!encoded) return null;
  history.replaceState(null, '', window.location.pathname + window.location.search);
  if (!is_allowed) return null;
  try {
    return test_overrides_schema.parse(JSON.parse(decode_base64url(encoded)));
  } catch (error) {
    console.warn('[company-use-deploy] the test settings in the address are not valid', error);
    return null;
  }
}

import { public_brand_config } from '@coworker/config/public_env';

export function page_title(name?: string): string {
  const brand = public_brand_config.product_brand_name;
  return name ? `${name} · ${brand}` : brand;
}

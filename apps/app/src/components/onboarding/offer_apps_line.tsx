import { OwnKeyOrAlferaCloud } from '@/components/app/own_key_or_alfera_cloud';
import type { CompanyScanFinding } from '@/lib/api';
import { useInstallHasAppCatalogue } from '@/lib/use_install_has_app_catalogue';

const list_of_names = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' });

/** Under an offer that needs an app: the apps to connect, or the two ways to get them when the install has no app catalogue key. */
export function OfferAppsLine({ finding }: { finding: CompanyScanFinding }) {
  const has_app_catalogue = useInstallHasAppCatalogue() !== false;
  const names = (finding.tools ?? []).map((tool) => tool.name);
  if (has_app_catalogue) {
    return names.length ? (
      <p className="ob-run__connect">Connect {list_of_names.format(names)}.</p>
    ) : null;
  }
  if (!names.length && !/^connect\s/iu.test(finding.prompt.trim())) return null;
  return (
    <p className="ob-run__connect">
      This job needs {names.length ? list_of_names.format(names) : 'a connected app'}:{' '}
      <OwnKeyOrAlferaCloud />
    </p>
  );
}

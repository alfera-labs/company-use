import {
  alfera_cloud_sign_up_url,
  connect_your_apps_guide_url,
} from '@coworker/config/hosted_defaults';
import { useInstallHasAppCatalogue } from '@/lib/use_install_has_app_catalogue';

const link_class = 'underline underline-offset-4 hover:text-foreground';

// A sample of what the app catalogue holds, so the page shows what a key brings. Names only:
// the list is not read from the catalogue, and nothing here can connect.
const apps_a_key_brings: readonly { name: string; what_it_is_for: string }[] = [
  { name: 'Gmail', what_it_is_for: 'Read, draft and send mail' },
  { name: 'Google Calendar', what_it_is_for: 'Read and plan meetings' },
  { name: 'Google Drive', what_it_is_for: 'Find and read files' },
  { name: 'Google Sheets', what_it_is_for: 'Read and fill sheets' },
  { name: 'Notion', what_it_is_for: 'Read and write pages' },
  { name: 'HubSpot', what_it_is_for: 'Contacts, deals and notes' },
  { name: 'Salesforce', what_it_is_for: 'Accounts and opportunities' },
  { name: 'GitHub', what_it_is_for: 'Issues and pull requests' },
  { name: 'Linear', what_it_is_for: 'Issues and projects' },
  { name: 'Stripe', what_it_is_for: 'Customers and payments' },
  { name: 'Airtable', what_it_is_for: 'Read and fill bases' },
  { name: 'Outlook', what_it_is_for: 'Mail and calendar' },
];

function AppsAKeyBrings() {
  return (
    <div className="mt-5">
      <h3 className="mb-3 font-medium text-muted-foreground text-xs uppercase">With a key</h3>
      <ul className="grid gap-x-8 gap-y-2 opacity-60 md:grid-cols-2 lg:grid-cols-3">
        {apps_a_key_brings.map((app) => (
          <li
            key={app.name}
            className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-3 px-2 py-2"
          >
            <div
              className="plate size-10 border border-strong border-dashed bg-transparent font-medium text-muted-foreground text-sm shadow-none"
              aria-hidden="true"
            >
              {app.name[0]}
            </div>
            <div className="min-w-0">
              <div className="truncate font-medium text-sm">{app.name}</div>
              <p className="text-muted-foreground text-xs">{app.what_it_is_for}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 px-2 text-muted-foreground text-xs">
        And the rest of the catalogue of your app provider.
      </p>
    </div>
  );
}

/** On an install with no app-provider key: what is missing, the one command, and the guide. */
export function AppCatalogueSetupChoices() {
  if (useInstallHasAppCatalogue() !== false) return null;
  return (
    <section className="mb-6 border-border/60 border-y py-4">
      <h2 className="font-medium text-sm">Apps need an app-provider key</h2>
      <p className="mt-1 text-muted-foreground text-sm">
        This install has no key for the app catalogue yet, so no app from it can connect. On the
        machine that runs Alfera, run{' '}
        <code className="rounded bg-muted px-1 py-0.5 text-foreground">./alfera add apps</code>,
        then reload this page.{' '}
        <a
          className={link_class}
          href={connect_your_apps_guide_url}
          rel="noreferrer"
          target="_blank"
        >
          Read the guide
        </a>
        , or{' '}
        <a className={link_class} href={alfera_cloud_sign_up_url} rel="noreferrer" target="_blank">
          use Alfera Cloud
        </a>
        , where apps connect in one click.
      </p>
      <AppsAKeyBrings />
    </section>
  );
}

import { alfera_cloud_sign_up_url } from '@coworker/config/hosted_defaults';
import { Button } from '@coworker/ui/components/button';

const what_this_install_does = [
  'Chats with you and works in its own sandbox: it runs commands and writes files',
  'Reads a public web page when you give it the address',
  'Remembers what you tell it, in files',
  'Runs automations while this machine is on: on a schedule, when you ask, when the web calls it, or when something happens in an app',
  'Uses outside apps, Slack, email and web search after you add your own keys',
];

const what_the_cloud_adds = [
  'Apps that connect in one click',
  'Company memory: answers from your documents',
  'Member links: which account in another app belongs to which teammate',
  'Slack, email and web search with no keys to set up',
  'A live browser view, and links that open the sites it builds',
  'Automations that run when your machine is off',
];

export function AlferaCloudSettings() {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 md:grid-cols-2">
        <PlainList title="This install" lines={what_this_install_does} />
        <PlainList title="Alfera Cloud adds" lines={what_the_cloud_adds} />
      </div>
      <div>
        <Button
          nativeButton={false}
          render={
            <a href={alfera_cloud_sign_up_url} rel="noreferrer" target="_blank">
              Open Alfera Cloud
            </a>
          }
        />
      </div>
    </div>
  );
}

function PlainList({ title, lines }: { title: string; lines: string[] }) {
  return (
    <section>
      <h2 className="font-medium text-foreground text-sm">{title}</h2>
      <ul className="mt-2 divide-y divide-border/60 border-border/60 border-y text-sm">
        {lines.map((line) => (
          <li className="py-2.5 text-muted-foreground text-pretty" key={line}>
            {line}
          </li>
        ))}
      </ul>
    </section>
  );
}

import {
  alfera_cloud_sign_up_url,
  connect_your_apps_guide_url,
} from '@coworker/config/hosted_defaults';

const link_class_name = 'underline underline-offset-4 hover:text-foreground';

/** The two ways to get a connected app on a self-host, as the end of a sentence. */
export function OwnKeyOrAlferaCloud() {
  return (
    <>
      <a
        className={link_class_name}
        href={connect_your_apps_guide_url}
        rel="noreferrer"
        target="_blank"
      >
        use your own key
      </a>{' '}
      or{' '}
      <a
        className={link_class_name}
        href={alfera_cloud_sign_up_url}
        rel="noreferrer"
        target="_blank"
      >
        use Alfera Cloud
      </a>
      .
    </>
  );
}

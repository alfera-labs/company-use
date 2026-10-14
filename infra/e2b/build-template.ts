import { defaultBuildLogger, Template } from 'e2b';
import template from './workspace-template';

// The template id the runtime starts every sandbox from. Set COWORKER_E2B_TEMPLATE_ID to this
// after a successful build; the previous image (coworker-nextjs) keeps serving running
// deployments until that variable is flipped.
const name = 'coworker-workspace';

async function main() {
  console.log(`Building E2B template "${name}" ...`);
  const info = await Template.build(template, name, {
    // 2 GB, up from the 1 GB default. Chrome with a few tabs plus the browser stream fills 1 GB
    // and every command slows to tens of seconds under memory pressure.
    memoryMB: 2048,
    cpuCount: 2,
    onBuildLogs: defaultBuildLogger({ minLevel: 'info' }),
  });
  console.log('BUILD_OK', JSON.stringify(info));
}

main().catch((error) => {
  console.error('BUILD_FAILED', error);
  process.exit(1);
});

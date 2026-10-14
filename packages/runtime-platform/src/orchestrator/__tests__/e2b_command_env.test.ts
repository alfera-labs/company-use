import { create_e2b_command_env } from '@runtime-platform/orchestrator/e2b_command';
import { trust_the_egress_proxy_certificate } from '@runtime-platform/orchestrator/sandbox_proxy_certificate';
import { describe, expect, it } from 'vitest';

describe('the sandbox command environment', () => {
  it('tells node to trust the CAs the image installed, so the egress proxy is accepted', () => {
    expect(create_e2b_command_env().NODE_OPTIONS).toBe('--use-system-ca');
  });

  it('still carries the identity and workspace variables every command depends on', () => {
    const env = create_e2b_command_env();

    expect(env).toMatchObject({
      USER: 'coworker',
      LOGNAME: 'coworker',
      SHELL: '/bin/bash',
      TMPDIR: '/tmp/coworker',
    });
    expect(env.HOME).toBeTruthy();
    expect(env.COWORKER_WORKSPACE_ROOT).toBeTruthy();
  });

  it('imports the proxy CA into the NSS store under the HOME the browser runs with', async () => {
    const commands: string[] = [];
    const sandbox = {
      commands: {
        run: async (command: string) => {
          commands.push(command);
        },
      },
    };

    await trust_the_egress_proxy_certificate(sandbox);

    expect(commands[0]).toContain(
      `certutil -d sql:${create_e2b_command_env().HOME}/.pki/nssdb -A -t "C,,"`,
    );
  });
});

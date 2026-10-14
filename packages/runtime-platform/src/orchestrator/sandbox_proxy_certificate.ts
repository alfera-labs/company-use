// Teach the sandbox's browser to trust the proxy that attaches our credentials.
//
// E2B attaches headers by terminating TLS for exactly the hosts we register a
// rule for, presenting a certificate signed by its own "E2B Proxy CA". curl and
// python trust it because that CA is in the system bundle. **Chrome does not read
// the system bundle** — on Linux it reads an NSS database under $HOME/.pki/nssdb,
// which does not exist in a fresh sandbox. So without this, every credential-
// carrying host fails in the browser with ERR_CERT_AUTHORITY_INVALID while the
// same request from curl succeeds. Measured, not guessed.
//
// This runs before the browser is ever launched. Chrome reads the trust store at
// startup, so importing afterwards has no effect until it restarts.
import { create_logger, format_error_message } from '@coworker/shared';
import { sandbox_home_directory } from '@runtime-platform/orchestrator/e2b_command';

const logger = create_logger('sandbox-proxy-certificate');

const certificate_store_path = `${sandbox_home_directory}/.pki/nssdb`;
const certificate_file_path = `${sandbox_home_directory}/.pki/e2b-proxy-ca.pem`;

const trust_proxy_certificate_script = `
set -eu
# certutil needs the database DIRECTORY to exist before it will create the
# database in it, and answers a missing one with SEC_ERROR_BAD_DATABASE.
mkdir -p ${certificate_store_path}
python3 - <<'FIND_CA'
import re, subprocess
bundle = open('/etc/ssl/certs/ca-certificates.crt').read()
for block in re.findall(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----', bundle, re.S):
    subject = subprocess.run(
        ['openssl', 'x509', '-noout', '-subject'], input=block, capture_output=True, text=True
    ).stdout
    if 'E2B' in subject:
        open('${certificate_file_path}', 'w').write(block)
        break
FIND_CA
test -s ${certificate_file_path} || { echo "no proxy certificate in the system bundle"; exit 1; }
test -f ${certificate_store_path}/cert9.db || certutil -d sql:${certificate_store_path} -N --empty-password
certutil -d sql:${certificate_store_path} -A -t "C,," -n "E2B Proxy CA" -i ${certificate_file_path}
`;

type SandboxCommandRunner = {
  commands: { run: (command: string, options?: { timeoutMs?: number }) => Promise<unknown> };
};

export async function trust_the_egress_proxy_certificate(
  sandbox: SandboxCommandRunner,
): Promise<void> {
  try {
    await sandbox.commands.run(trust_proxy_certificate_script, { timeoutMs: 60_000 });
  } catch (error) {
    logger.warn(
      `the browser will not trust credential-carrying hosts: ${format_error_message(error)}`,
    );
  }
}

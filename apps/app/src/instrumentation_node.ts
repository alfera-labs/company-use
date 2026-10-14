import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '@dotenvx/dotenvx';
import { clear_workos_cookie_domain_env_var } from '@/lib/auth_cookie_scope';
import runtime_env_keys_file from '@/runtime_env_keys.json';

const required_runtime_env_keys: readonly string[] =
  runtime_env_keys_file.required_runtime_env_keys;

// Runtime env decryption for Vercel.
//
// Vercel serverless functions do not run our dotenvx-wrapped start command. When native
// Vercel env vars are incomplete, this hook decrypts the committed dotenvx env at server
// startup so the proxy + route handlers see the auth/API values they need.
//
// server.ts calls this first, before importing libraries that snapshot env at import time.
// scripts/vercel-build.sh writes the app's keys from the selected encrypted file to
// .env.runtime.enc and copies it into the Nitro function directory
// (.vercel/output/functions/__server.func), which Vercel runs as /var/task. Every decrypt is
// asymmetric, so that file holds this app's keys and not the whole monorepo's: a cold function
// pays this before its first response, and sign-in crosses several.
//
// Locally we skip all of this: `bun run dev` and `bun run start` already inject env via dotenvx and
// load per-worktree overrides from .env.local that we must not clobber.
let did_decrypt_vercel_runtime_env = false;

export function decrypt_vercel_runtime_env() {
  if (did_decrypt_vercel_runtime_env) return;
  did_decrypt_vercel_runtime_env = true;

  clear_workos_cookie_domain_env_var();

  if (!process.env.VERCEL) return;
  if (has_vercel_native_runtime_env(process.env)) return;

  const env_file = find_runtime_env_file();
  if (!env_file) {
    console.error('[instrumentation] .env.runtime.enc missing; runtime secrets will be empty');
    return;
  }

  // The decrypted values are the source of truth; overload anything the platform preloaded.
  // dotenvx reads the DOTENV_PUBLIC_KEY_<env> header inside the file to pick the matching
  // DOTENV_PRIVATE_KEY_<env>, so the filename does not matter.
  config({ path: [env_file], overload: true, ignore: ['MISSING_ENV_FILE'] });
  clear_workos_cookie_domain_env_var();
}

// The build writes .env.runtime.enc to the app root and copies it next to the server bundle
// (scripts/vercel-build.sh). Where the deployed function finds it depends on how the platform
// packages the output, so both spots are checked: the working directory (local `vite preview`,
// platforms that keep the app root) and the bundle's own directory (Vercel functions).
function find_runtime_env_file(): string | undefined {
  const module_directory = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), '.env.runtime.enc'),
    join(module_directory, '.env.runtime.enc'),
    join(module_directory, '..', '.env.runtime.enc'),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

export function has_vercel_native_runtime_env(env: NodeJS.ProcessEnv) {
  return required_runtime_env_keys.every((key) => has_env_value(env[key]));
}

function has_env_value(value: string | undefined) {
  return typeof value === 'string' && value.trim().length > 0;
}

import { initialize_api_sentry } from '@api/lib/sentry';

// This module is preloaded by Node before server.ts. Sentry's ESM instrumentation must run
// before Hono and postgres.js are imported or their request/query spans cannot be patched.
initialize_api_sentry();

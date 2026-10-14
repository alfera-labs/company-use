import { database_url_or_default } from '@coworker/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './packages/core/src/db/schema/index.ts',
  out: './packages/core/src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: database_url_or_default(),
  },
});

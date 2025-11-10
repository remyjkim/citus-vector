// ABOUTME: Drizzle Kit configuration for database migrations and schema management.
// ABOUTME: Configures schema path, migrations directory, and PostgreSQL connection.
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});

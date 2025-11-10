// ABOUTME: Migration runner script that applies SQL migrations to the database.
// ABOUTME: Executes migration files in order using postgres.js client.
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, sql } from './client.js';

async function runMigrations() {
  console.log('Running migrations...');

  try {
    await migrate(db, { migrationsFolder: './db/migrations' });
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

runMigrations();

// ABOUTME: Database client configuration using Drizzle ORM with postgres.js driver.
// ABOUTME: Connects to PostgreSQL using DATABASE_URL environment variable.
import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

export const sql = postgres(connectionString);
export const db = drizzle(sql);

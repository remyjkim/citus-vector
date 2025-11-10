// ABOUTME: Configures database-level performance settings for pgvector and Citus.
// ABOUTME: Sets GUC variables that must be at database level (session settings don't propagate to workers).
import 'dotenv/config';
import { sql } from './client.js';

async function configureCitus() {
  console.log('Configuring database-level performance settings...');

  try {
    // pgvector HNSW query tuning (higher = better recall, slower queries)
    console.log('Setting hnsw.ef_search = 200...');
    await sql`ALTER DATABASE postgres SET hnsw.ef_search = 200`;

    // Memory for index building (higher = faster index builds)
    console.log('Setting maintenance_work_mem = 2GB...');
    await sql`ALTER DATABASE postgres SET maintenance_work_mem = '2GB'`;

    // Parallel query execution (higher = faster parallel queries)
    console.log('Setting max_parallel_workers_per_gather = 4...');
    await sql`ALTER DATABASE postgres SET max_parallel_workers_per_gather = 4`;

    console.log('\nConfiguration completed successfully!');
    console.log('⚠️  Reconnect to database for settings to take effect');
  } catch (error) {
    console.error('Configuration failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

configureCitus();

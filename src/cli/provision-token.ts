// Provision a demo user token and print its plaintext value once.
import { provisionToken } from '../application/auth.js';
import { readConfig } from '../config.js';
import { SqliteJobStore } from '../infrastructure/sqlite/job-store.js';

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error('Usage: npm run auth:token -- <user-id>');
  process.exitCode = 1;
} else {
  let store: SqliteJobStore | undefined;
  try {
    store = new SqliteJobStore(readConfig().databasePath);
    const token = provisionToken(store, args[0]!);
    // This is the sole plaintext output; never add it to a log or persisted record.
    process.stdout.write(token + '\n');
  } catch {
    // Do not echo arguments or exception details: they may contain sensitive input.
    console.error(
      'Token provisioning failed. Check user ID, database configuration, and file permissions.',
    );
    process.exitCode = 1;
  } finally {
    store?.close();
  }
}

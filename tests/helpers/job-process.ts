// Run queue operations in a child process for concurrency tests.
import { SqliteJobStore } from '../../src/infrastructure/sqlite/job-store.js';

const [path, action] = process.argv.slice(2);
if (!path || !action || !process.send) throw new Error('Test helper requires IPC and arguments');
const store = new SqliteJobStore(path);
process.send({ ready: true });
process.once('message', () => {
  const result =
    action === 'create'
      ? store.create('https://example.com/', 'shared-key', 'fixture-user')
      : store.claim(200);
  store.close();
  process.send?.({ result: result ?? null }, () => process.disconnect());
});

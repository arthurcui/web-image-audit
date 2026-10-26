// Start the labeled fixture server on its loopback port.
import { createFixtureServer } from './fixture.js';
const server = createFixtureServer();
server.listen(3105, '127.0.0.1', () =>
  process.stderr.write(
    JSON.stringify({ event: 'fixture_started', mode: 'fixture', port: 3105 }) + '\n',
  ),
);
server.on('error', () => {
  process.stderr.write('{"event":"fixture_start_failed"}\n');
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    server.closeAllConnections();
    server.close();
  });

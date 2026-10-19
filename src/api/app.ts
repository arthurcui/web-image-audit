import Fastify from 'fastify';
import { getHealth } from '../application/health.js';

export function buildApp(options: { logger?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? false });
  app.get('/api/health', async () => getHealth());
  return app;
}

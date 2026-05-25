import type { FastifyInstance } from 'fastify';

export default async function healthRoute(app: FastifyInstance) {
  app.get('/health', async () => ({ ok: true }));
}

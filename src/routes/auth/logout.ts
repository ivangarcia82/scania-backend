import type { FastifyInstance } from 'fastify';

export default async function logoutRoute(app: FastifyInstance) {
  app.post('/logout', async (_req, reply) => {
    app.clearSessionCookie(reply);
    return reply.code(204).send();
  });
}

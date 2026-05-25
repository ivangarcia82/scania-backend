import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

interface ErrorBody {
  error: { code: string; message: string; issues?: unknown };
}

export function buildErrorHandler(nodeEnv: string) {
  return function errorHandler(
    error: FastifyError | Error,
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    if (error instanceof AppError) {
      request.log.warn({ err: error, code: error.code }, 'AppError');
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message },
      } satisfies ErrorBody);
    }

    if (error instanceof ZodError) {
      request.log.warn({ err: error }, 'Validation error');
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Datos inválidos',
          issues: error.issues,
        },
      } satisfies ErrorBody);
    }

    // Fastify validation errors (rate limit, etc.) carry a statusCode
    const fastifyErr = error as FastifyError;
    if (fastifyErr.statusCode === 429) {
      return reply.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Demasiados intentos, intenta de nuevo más tarde' },
      } satisfies ErrorBody);
    }
    if (fastifyErr.statusCode && fastifyErr.statusCode >= 400 && fastifyErr.statusCode < 500) {
      return reply.code(fastifyErr.statusCode).send({
        error: { code: 'BAD_REQUEST', message: fastifyErr.message },
      } satisfies ErrorBody);
    }

    request.log.error({ err: error }, 'Unhandled error');
    return reply.code(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: nodeEnv === 'production' ? 'Internal server error' : error.message,
      },
    } satisfies ErrorBody);
  };
}

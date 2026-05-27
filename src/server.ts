import { writeSync } from 'node:fs';

// Boot diagnostics. writeSync(2, ...) writes to stderr SYNCHRONOUSLY, so these
// lines survive even if the process is killed (e.g. Railway SIGKILL after a
// healthcheck timeout) before Fastify's async pino/sonic-boom logger flushes
// its buffer. Without this, a crash during startup leaves no trace in the
// platform logs (the "logs cut off after migrate" symptom).
function boot(msg: string): void {
  const line = `[boot] ${msg}\n`;
  // Write to BOTH stdout (1) and stderr (2), synchronously, so the line is
  // captured no matter which stream the platform forwards.
  try {
    writeSync(1, line);
  } catch {
    // ignore
  }
  try {
    writeSync(2, line);
  } catch {
    // ignore: diagnostics must never throw
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err);
}

process.on('uncaughtException', (err) => {
  boot(`uncaughtException: ${describe(err)}`);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  boot(`unhandledRejection: ${describe(err)}`);
  process.exit(1);
});

async function main(): Promise<void> {
  boot('process started; importing ./config/env.js');
  const { env } = await import('./config/env.js');
  boot(`env validated (NODE_ENV=${env.NODE_ENV}, PORT=${env.PORT})`);

  boot('importing ./app.js (loads native deps: argon2, @prisma/client)');
  const { createApp } = await import('./app.js');

  boot('building Fastify app');
  const app = await createApp();

  // Listen on :: (IPv6 wildcard). Railway's private network — including the
  // healthcheck probe to internal services — is IPv6. Binding to 0.0.0.0 only
  // listens on IPv4, so the IPv6 healthcheck gets "connection refused" and the
  // deploy fails at the healthcheck step. On Linux, :: is dual-stack and also
  // accepts IPv4, so this covers both.
  boot(`calling listen on [::]:${env.PORT}`);
  await app.listen({ host: '::', port: env.PORT });
  boot('listen resolved — server is accepting connections');
}

main().catch((err) => {
  boot(`fatal during startup: ${describe(err)}`);
  process.exit(1);
});

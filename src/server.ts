import { createApp } from './app.js';
import { env } from './config/env.js';

async function main() {
  const app = await createApp();
  try {
    await app.listen({ host: '0.0.0.0', port: env.PORT });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();

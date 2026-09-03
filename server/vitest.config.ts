import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 20000,
    // Each file gets its own in-memory database; running them serially keeps
    // the shared module-level db handle predictable.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      ACCESS_TOKEN_SECRET: 'test-access-secret-0123456789abcdef0123456789abcdef',
      REFRESH_TOKEN_SECRET: 'test-refresh-secret-0123456789abcdef0123456789abcdef',
      QR_TOKEN_SECRET: 'test-qr-secret-0123456789abcdef0123456789abcdef',
      CORS_ORIGINS: 'http://localhost:5173,http://localhost:5174',
    },
  },
});

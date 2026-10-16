import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: process.env.CD_DEBUG ? ['tests/debug/**/*.test.ts'] : ['tests/unit/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120_000,
    pool: 'forks',
    maxWorkers: 2,
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    globals: false,
    // Each test file gets its own module scope — prevents shared state leaking
    isolate: true,
  },
});

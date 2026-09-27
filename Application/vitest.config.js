// Written by Irmak Hakman in 2026.
// Copyright (c) 2026 Irmak Hakman
// SPDX-License-Identifier: BUSL-1.1  (see LICENSE)

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

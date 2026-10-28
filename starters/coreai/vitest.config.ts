// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['app/**/*.test.{ts,tsx}'],
  },
});

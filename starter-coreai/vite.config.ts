// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { fileURLToPath } from 'node:url';
import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [reactRouter()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '~': fileURLToPath(new URL('./app', import.meta.url)),
      '@coreai-ds/react-components': fileURLToPath(
        new URL('../../packages/react-components/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
});

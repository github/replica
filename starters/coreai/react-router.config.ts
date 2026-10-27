// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { Config } from '@react-router/dev/config';
import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

export default {
  ssr: false,
  async buildEnd({ reactRouterConfig, viteConfig }) {
    // Replica packages the finished SPA from dist, not React Router's client directory.
    const dist = join(viteConfig.root, 'dist');
    await rm(dist, { recursive: true, force: true });
    await rename(join(reactRouterConfig.buildDirectory, 'client'), dist);
  },
} satisfies Config;

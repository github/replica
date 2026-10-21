// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { HomeData } from '~/data';

import { useQuery } from '@tanstack/react-query';

import { homeData } from '~/data';

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useHomeData() {
  return useQuery({
    queryKey: ['home'],
    queryFn: async (): Promise<HomeData> => {
      await delay(400);
      return homeData;
    },
  });
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useQuery } from '@tanstack/react-query';

export interface UserInfo {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
  claims?: Array<{
    typ: string;
    val: string;
  }>;
}

export interface AuthResponse {
  clientPrincipal: UserInfo | null;
}

async function fetchUserInfo(): Promise<UserInfo | null> {
  // Skip auth check in local development
  if (import.meta.env.DEV) {
    return null;
  }

  const response = await fetch('/.auth/me');
  if (!response.ok) {
    return null; // Return null instead of throwing on auth errors
  }
  const payload: AuthResponse = await response.json();
  return payload.clientPrincipal;
}

export function useUserInfo() {
  return useQuery({
    queryKey: ['userInfo'],
    queryFn: fetchUserInfo,
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: false, // Don't retry auth failures
    enabled: !import.meta.env.DEV, // Disable in dev mode
  });
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { Cookie } from 'react-router';

export async function setCookie(cookie: Cookie, value: unknown): Promise<void> {
  const serializedCookie = await cookie.serialize(value);
  document.cookie = serializedCookie;
}

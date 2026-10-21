// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { AzureOpenAI } from 'openai';
import type { AzureOpenAISettings } from '~/hooks/useAzureOpenAISettings';

/**
 * Creates an AzureOpenAI client configured for Azure OpenAI.
 *
 * @example
 * ```ts
 * const settings = {
 *   endpoint: 'https://your-resource.openai.azure.com',
 *   deployment: 'gpt-4o',
 *   apiKey: '...',
 *   apiVersion: '2025-04-01-preview'
 * };
 * const { client, deployment } = createAzureOpenAIClient(settings);
 *
 * const completion = await client.chat.completions.create({
 *   messages: [{ role: 'user', content: 'Hello!' }],
 *   model: deployment,
 * });
 * ```
 */
export function createAzureOpenAIClient(settings: AzureOpenAISettings): {
  client: AzureOpenAI;
  deployment: string;
} {
  if (!settings.endpoint || !settings.deployment || !settings.apiKey) {
    throw new Error(
      'Azure OpenAI is not configured. Please configure your endpoint, deployment, and API key in settings.',
    );
  }

  const client = new AzureOpenAI({
    dangerouslyAllowBrowser: true,
    endpoint: settings.endpoint,
    apiKey: settings.apiKey,
    deployment: settings.deployment,
    apiVersion: settings.apiVersion,
  });

  return {
    client,
    deployment: settings.deployment,
  };
}

export type { AzureOpenAISettings };

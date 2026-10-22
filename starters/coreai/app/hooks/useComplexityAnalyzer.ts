// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useState, useCallback } from 'react';
import { useAzureOpenAISettings } from './useAzureOpenAISettings';
import { createAzureOpenAIClient } from '~/core/utils/azureOpenAI';

export interface ComplexityResult {
  isComplex: boolean;
  reason: string;
}

export interface UseComplexityAnalyzerReturn {
  /** Analyze instructions for complexity */
  analyze: (instructions: string) => Promise<void>;
  /** The result of the analysis */
  result: ComplexityResult | null;
  /** Whether analysis is in progress */
  isAnalyzing: boolean;
  /** Any error that occurred */
  error: string | null;
  /** Clear the current result */
  clearResult: () => void;
  /** Whether Azure OpenAI is configured */
  isConfigured: boolean;
}

const COMPLEXITY_PROMPT = `You are an AI agent architecture advisor. Analyze the following agent instructions and determine if they describe a task that is too complex for a single agent and would work better as a multi-step workflow.

Return ONLY valid JSON in this exact format: {"isComplex": boolean, "reason": "string"}

Set isComplex to true if the instructions contain ANY of these patterns:
- Multiple distinct sequential steps (e.g., "first do X, then do Y, finally do Z")
- Chained/dependent operations where the output of one step feeds into another
- Multiple separate responsibilities that could be handled by independent specialized agents
- Complex conditional branching with different paths

Set isComplex to false if:
- The instructions describe a single cohesive task
- The agent has one clear responsibility
- Steps are simple variations of the same core action

Keep the reason to ONE brief sentence explaining why.

Agent Instructions to analyze:
`;

export function useComplexityAnalyzer(): UseComplexityAnalyzerReturn {
  const { settings, isConfigured } = useAzureOpenAISettings();
  const [result, setResult] = useState<ComplexityResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = useCallback(
    async (instructions: string) => {
      // Don't analyze empty instructions
      if (!instructions.trim()) {
        setResult(null);
        return;
      }

      // Can't analyze without Azure OpenAI configured
      if (!isConfigured) {
        setError('Azure OpenAI is not configured');
        return;
      }

      setIsAnalyzing(true);
      setError(null);

      try {
        const { client, deployment } = createAzureOpenAIClient(settings);

        const response = await client.chat.completions.create({
          messages: [
            {
              role: 'user',
              content: COMPLEXITY_PROMPT + instructions,
            },
          ],
          model: deployment,
          max_tokens: 100,
          temperature: 0.1, // Low temperature for consistent classification
        });

        const content = response.choices[0]?.message?.content;
        console.log('🔍 Complexity analysis raw response:', content);

        if (!content) {
          throw new Error('No response from model');
        }

        // Parse the JSON response
        const parsed = JSON.parse(content) as ComplexityResult;
        console.log('🔍 Complexity analysis parsed:', parsed);

        if (typeof parsed.isComplex !== 'boolean' || typeof parsed.reason !== 'string') {
          throw new Error('Invalid response format');
        }

        setResult(parsed);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Analysis failed';
        setError(errorMessage);
        console.error('Complexity analysis error:', err);
      } finally {
        setIsAnalyzing(false);
      }
    },
    [isConfigured, settings],
  );

  const clearResult = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return {
    analyze,
    result,
    isAnalyzing,
    error,
    clearResult,
    isConfigured,
  };
}

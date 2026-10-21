// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useState, useCallback } from 'react';
import type OpenAI from 'openai';
import { useAzureOpenAISettings } from './useAzureOpenAISettings';
import { createAzureOpenAIClient } from '~/core/utils/azureOpenAI';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  isStreaming?: boolean;
}

export interface UseChatOptions {
  /** System prompt to set the assistant's behavior */
  systemPrompt?: string;
}

export interface UseChatReturn {
  /** The list of messages in the conversation */
  messages: ChatMessage[];
  /** Whether a message is currently being sent/received */
  isLoading: boolean;
  /** Any error that occurred */
  error: string | null;
  /** Send a message to the assistant */
  sendMessage: (content: string) => Promise<void>;
  /** Clear all messages and start a new conversation */
  clearMessages: () => void;
  /** Whether Azure OpenAI is configured */
  isConfigured: boolean;
}

let messageIdCounter = 0;

function generateMessageId(): string {
  messageIdCounter += 1;
  return `msg-${Date.now()}-${messageIdCounter}`;
}

export function useChat(options: UseChatOptions = {}): UseChatReturn {
  const { systemPrompt } = options;
  const { settings, isConfigured } = useAzureOpenAISettings();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) {
        return;
      }

      // Add user message
      const userMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'user',
        content: content.trim(),
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setIsLoading(true);
      setError(null);

      let assistantMessageId: string | undefined;

      try {
        const { client, deployment } = createAzureOpenAIClient(settings);

        // Build messages array for the API
        const apiMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

        // Add system prompt if provided
        if (systemPrompt) {
          apiMessages.push({
            role: 'system',
            content: systemPrompt,
          });
        }

        // Add all previous messages plus the new one
        const allMessages = [...messages, userMessage];
        for (const msg of allMessages) {
          if (msg.role === 'user' || msg.role === 'assistant') {
            apiMessages.push({
              role: msg.role,
              content: msg.content,
            });
          }
        }

        // Create a streaming request
        const stream = await client.chat.completions.create({
          messages: apiMessages,
          model: deployment,
          stream: true,
        });

        // Create an assistant message placeholder
        assistantMessageId = generateMessageId();
        const assistantMessage: ChatMessage = {
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          timestamp: new Date(),
          isStreaming: true,
        };

        // Add the streaming message placeholder
        setMessages((prev) => [...prev, assistantMessage]);

        // Stream the response
        let fullContent = '';
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content ?? '';
          if (delta) {
            fullContent += delta;
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId ? { ...msg, content: fullContent } : msg,
              ),
            );
          }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
        setError(errorMessage);
        console.error('Chat error:', err);
      } finally {
        if (assistantMessageId) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMessageId ? { ...msg, isStreaming: false } : msg,
            ),
          );
        }
        setIsLoading(false);
      }
    },
    [isConfigured, settings, systemPrompt, messages],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
    isConfigured,
  };
}

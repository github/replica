// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useState, useCallback, useEffect, useRef } from 'react';
import replies from '~/data/chat-replies.json';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface UseChatReturn {
  messages: ChatMessage[];
  isLoading: boolean;
  sendMessage: (content: string) => Promise<void>;
  clearMessages: () => void;
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const replyIndex = useRef(0);
  const messageId = useRef(0);
  const pendingReply = useRef<{
    timer: ReturnType<typeof setTimeout>;
    resolve: () => void;
  } | null>(null);

  const cancelReply = useCallback(() => {
    const pending = pendingReply.current;
    pendingReply.current = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve();
    }
  }, []);

  useEffect(() => cancelReply, [cancelReply]);

  const sendMessage = useCallback((content: string): Promise<void> => {
    const trimmed = content.trim();
    if (!trimmed || pendingReply.current) return Promise.resolve();

    setMessages((previous) => [
      ...previous,
      {
        id: `msg-${++messageId.current}`,
        role: 'user',
        content: trimmed,
        timestamp: new Date(),
      },
    ]);
    setIsLoading(true);

    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        pendingReply.current = null;
        const reply = replies[replyIndex.current];
        replyIndex.current = (replyIndex.current + 1) % replies.length;
        setMessages((previous) => [
          ...previous,
          {
            id: `msg-${++messageId.current}`,
            role: 'assistant',
            content: reply,
            timestamp: new Date(),
          },
        ]);
        setIsLoading(false);
        resolve();
      }, 600);
      pendingReply.current = { timer, resolve };
    });
  }, []);

  const clearMessages = useCallback(() => {
    cancelReply();
    replyIndex.current = 0;
    setMessages([]);
    setIsLoading(false);
  }, [cancelReply]);

  return { messages, isLoading, sendMessage, clearMessages };
}

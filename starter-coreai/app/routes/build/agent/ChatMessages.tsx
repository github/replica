import type { JSX } from 'react';
import { useRef, useEffect } from 'react';
import {
  Text,
  Spinner,
  Avatar,
  Markdown,
  Button,
  InfoButton,
  CopyButton,
  Divider,
} from '@coreai-ds/react-components';
import { PersonRegular, BotRegular, DeleteRegular } from '@fluentui/react-icons';
import { clsx } from 'clsx';
import type { ChatMessage } from '~/hooks/useChat';

import styles from './ChatMessages.module.css';

interface ChatMessagesProps {
  messages: ChatMessage[];
  isLoading: boolean;
  error: string | null;
  className?: string;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function ChatMessages({
  messages,
  isLoading,
  error,
  className,
}: ChatMessagesProps): JSX.Element {
  const chatWindowRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatWindowRef.current) {
      chatWindowRef.current.scrollTo({
        top: chatWindowRef.current.scrollHeight + 1000,
        // behavior: 'smooth',
      });
    }
  }, [messages, isLoading]);

  return (
    <div className={clsx(styles.chatMessages, className)} ref={chatWindowRef}>
      {messages.length === 0 ? (
        <div className={styles.emptyState}>
          <Text as="h2" preset="heading2" foreground={1}>
            Tool-test-1
          </Text>
          <Text preset="body" foreground={3} block>
            Use agent configuration to update the description and starter prompts
          </Text>
        </div>
      ) : (
        <>
          <div className={styles.messageList}>
            {messages.map((message) => (
              <div
                key={message.id}
                className={clsx(
                  styles.message,
                  message.role === 'user' ? styles.userMessage : styles.assistantMessage,
                )}
              >
                <div className={styles.messageHeader}>
                  <Avatar
                    size={24}
                    icon={message.role === 'user' ? <PersonRegular /> : <BotRegular />}
                  />
                  <Text foreground={1} preset="bodySStrong">
                    {message.role === 'user' ? 'You' : 'Assistant'}
                  </Text>
                  <Text preset="bodyS" foreground={3} className={styles.timestamp}>
                    {formatTime(message.timestamp)}
                  </Text>
                </div>
                <div className={styles.messageContent}>
                  <Markdown content={message.content} />
                  {message.isStreaming && <span className={styles.streamingCursor}>...</span>}
                </div>
                {message.role === 'assistant' && (
                  <div className={styles.messageActions}>
                    <Text preset="bodyS" foreground={2}>
                      gpt-0.0
                    </Text>
                    <Divider vertical />
                    <Text preset="bodyS" foreground={2}>
                      00.0s
                    </Text>
                    <Divider vertical />
                    <div className={styles.tokenInfo}>
                      <Text preset="bodyS" foreground={2}>
                        000t
                      </Text>
                      <InfoButton
                        aria-label="Response tokens"
                        size="small"
                        info="Token usage information"
                      />
                    </div>
                    <Divider vertical />
                    <CopyButton
                      contentToCopy={message.content}
                      size="small"
                      aria-label={`Copy message ${message.id}`}
                    />
                    <Button
                      appearance="subtle"
                      size="small"
                      icon={<DeleteRegular />}
                      aria-label="Delete message"
                    />
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className={styles.loadingIndicator}>
                <Spinner size="tiny" />
                <Text preset="bodyS" foreground={3}>
                  Assistant is responding...
                </Text>
              </div>
            )}

            {error && (
              <div className={styles.errorMessage}>
                <Text foreground={1} preset="bodyStrong">
                  Error:
                </Text>
                <Text preset="body" foreground={2}>
                  {error}
                </Text>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

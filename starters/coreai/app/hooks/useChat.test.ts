// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act, cleanup, renderHook } from '@testing-library/react';
import type OpenAI from 'openai';
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useChat } from './useChat';
import type { UseAzureOpenAISettingsReturn } from './useAzureOpenAISettings';

type CreateOptions = Parameters<OpenAI['chat']['completions']['create']>[1];

const { create } = vi.hoisted(() => ({
  create: vi.fn<
    (
      body: ChatCompletionCreateParamsStreaming,
      options?: CreateOptions,
    ) => Promise<AsyncIterable<ChatCompletionChunk>>
  >(),
}));

vi.mock('~/core/utils/azureOpenAI', () => ({
  createAzureOpenAIClient: () => ({
    client: { chat: { completions: { create } } },
    deployment: 'test-deployment',
  }),
}));

vi.mock('./useAzureOpenAISettings', () => ({
  useAzureOpenAISettings: (): UseAzureOpenAISettingsReturn => ({
    settings: { endpoint: '', deployment: '', apiKey: '', apiVersion: '' },
    isConfigured: true,
    setSettings: vi.fn(),
    clearSettings: vi.fn(),
  }),
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function chunk(content: string): ChatCompletionChunk {
  return {
    id: 'test-chunk',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-deployment',
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  };
}

function response(...contents: string[]) {
  return {
    controller: new AbortController(),
    async *[Symbol.asyncIterator]() {
      for (const content of contents) yield chunk(content);
    },
  };
}

afterEach(() => {
  cleanup();
  create.mockReset();
  vi.restoreAllMocks();
});

describe('useChat', () => {
  it('starts a new chat immediately and aborts a pending request', async () => {
    const pending = deferred<AsyncIterable<ChatCompletionChunk>>();
    create.mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useChat());
    let sending!: Promise<void>;

    act(() => {
      sending = result.current.sendMessage('Old conversation');
    });
    expect(result.current.isLoading).toBe(true);

    act(() => result.current.clearMessages());

    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(create.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);

    await act(async () => {
      pending.resolve(response());
      await sending;
    });
  });

  it('discards a delayed old response without finishing the new request', async () => {
    const oldRequest = deferred<AsyncIterable<ChatCompletionChunk>>();
    const newRequest = deferred<AsyncIterable<ChatCompletionChunk>>();
    create.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    const { result } = renderHook(() => useChat());
    let oldSending!: Promise<void>;
    let newSending!: Promise<void>;

    act(() => {
      oldSending = result.current.sendMessage('Old conversation');
    });
    act(() => result.current.clearMessages());
    act(() => {
      newSending = result.current.sendMessage('New conversation');
    });

    await act(async () => {
      oldRequest.resolve(response('Stale reply'));
      await oldSending;
    });

    expect(result.current.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'New conversation' },
    ]);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(true);
    expect(create.mock.calls[1]?.[0].messages).toEqual([
      { role: 'user', content: 'New conversation' },
    ]);

    await act(async () => {
      newRequest.resolve(response('Current reply'));
      await newSending;
    });
    expect(result.current.messages.map(({ content }) => content)).toEqual([
      'New conversation',
      'Current reply',
    ]);
    expect(result.current.isLoading).toBe(false);
  });

  it('discards a delayed old rejection without setting an error or finishing the new request', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const oldRequest = deferred<AsyncIterable<ChatCompletionChunk>>();
    const newRequest = deferred<AsyncIterable<ChatCompletionChunk>>();
    create.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    const { result } = renderHook(() => useChat());
    let oldSending!: Promise<void>;
    let newSending!: Promise<void>;

    act(() => {
      oldSending = result.current.sendMessage('Old conversation');
    });
    act(() => result.current.clearMessages());
    act(() => {
      newSending = result.current.sendMessage('New conversation');
    });
    await act(async () => {
      oldRequest.reject(new Error('Stale failure'));
      await oldSending;
    });

    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.messages.map(({ content }) => content)).toEqual(['New conversation']);

    await act(async () => {
      newRequest.resolve(response('Current reply'));
      await newSending;
    });
  });

  it('discards remaining chunks and completion when reset during streaming', async () => {
    const resumeOldStream = deferred<void>();
    const newRequest = deferred<AsyncIterable<ChatCompletionChunk>>();
    const oldStream = {
      controller: new AbortController(),
      async *[Symbol.asyncIterator]() {
        yield chunk('Before reset');
        await resumeOldStream.promise;
        yield chunk('Stale chunk');
      },
    };
    create.mockResolvedValueOnce(oldStream).mockReturnValueOnce(newRequest.promise);
    const { result } = renderHook(() => useChat());
    let oldSending!: Promise<void>;
    let newSending!: Promise<void>;

    await act(async () => {
      oldSending = result.current.sendMessage('Old conversation');
    });
    expect(result.current.messages.at(-1)?.content).toBe('Before reset');
    act(() => result.current.clearMessages());
    act(() => {
      newSending = result.current.sendMessage('New conversation');
    });
    await act(async () => {
      resumeOldStream.resolve();
      await oldSending;
    });

    expect(result.current.messages.map(({ content }) => content)).toEqual(['New conversation']);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(true);
    expect(create.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);

    await act(async () => {
      newRequest.resolve(response('Current reply'));
      await newSending;
    });
  });

  it('streams a normal reply and includes conversation history in the next request', async () => {
    create.mockResolvedValueOnce(response('Hello', ' there')).mockResolvedValueOnce(response('Again'));
    const { result } = renderHook(() => useChat({ systemPrompt: 'Be helpful' }));

    await act(async () => {
      await result.current.sendMessage('  First question  ');
    });

    expect(result.current.messages.map(({ role, content, isStreaming }) => ({
      role, content, isStreaming,
    }))).toEqual([
      { role: 'user', content: 'First question', isStreaming: undefined },
      { role: 'assistant', content: 'Hello there', isStreaming: false },
    ]);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);

    await act(async () => {
      await result.current.sendMessage('Follow-up');
    });
    expect(create.mock.calls[1]?.[0].messages).toEqual([
      { role: 'system', content: 'Be helpful' },
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'Hello there' },
      { role: 'user', content: 'Follow-up' },
    ]);
  });

  it('reports a current request failure and clears it on a new chat', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    create.mockRejectedValueOnce(new Error('Request failed'));
    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.sendMessage('Question');
    });
    expect(result.current.error).toBe('Request failed');
    expect(result.current.isLoading).toBe(false);

    act(() => result.current.clearMessages());
    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('aborts an outstanding request when the hook unmounts', async () => {
    const pending = deferred<AsyncIterable<ChatCompletionChunk>>();
    create.mockReturnValueOnce(pending.promise);
    const { result, unmount } = renderHook(() => useChat());
    let sending!: Promise<void>;
    act(() => {
      sending = result.current.sendMessage('Question');
    });

    unmount();
    expect(create.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);

    await act(async () => {
      pending.resolve(response('Late reply'));
      await sending;
    });
  });
});

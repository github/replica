// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChat } from './useChat';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('useChat', () => {
  it('cycles through three distinct replies and wraps without a network request', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected request'));
    const { result } = renderHook(() => useChat());
    const replies: string[] = [];

    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);

    for (let index = 0; index < 4; index += 1) {
      let sending!: Promise<void>;
      act(() => {
        sending = result.current.sendMessage(`Question ${index}`);
      });
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
        await sending;
      });

      expect(result.current.messages).toHaveLength((index + 1) * 2);
      expect(result.current.messages.at(-1)?.role).toBe('assistant');
      expect(result.current.messages.at(-1)?.content.trim()).not.toBe('');
      replies.push(result.current.messages.at(-1)!.content);
    }

    expect(new Set(replies.slice(0, 3)).size).toBe(3);
    expect(replies[3]).toBe(replies[0]);
    expect(result.current.isLoading).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('trims input, shows loading until the reply, and ignores empty and duplicate sends', async () => {
    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.sendMessage(' \n\t ');
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);

    let sending!: Promise<void>;
    let duplicate!: Promise<void>;
    act(() => {
      sending = result.current.sendMessage('  First question \n');
      duplicate = result.current.sendMessage('Duplicate before rerender');
    });
    await act(async () => {
      await duplicate;
      await result.current.sendMessage('Duplicate while loading');
      await result.current.sendMessage('');
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'First question' }),
    ]);

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await sending;
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.messages).toHaveLength(2);
    const firstReply = result.current.messages[1].content;
    for (const message of result.current.messages) {
      expect(message.id).toEqual(expect.any(String));
      expect(message.id).not.toBe('');
      expect(message.timestamp).toBeInstanceOf(Date);
    }
    expect(new Set(result.current.messages.map(({ id }) => id)).size).toBe(2);

    act(() => result.current.clearMessages());
    act(() => {
      sending = result.current.sendMessage('A clean first question');
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await sending;
    });
    expect(result.current.messages[1].content).toBe(firstReply);
  });

  it('starts a new chat by clearing messages, resolving a pending send, and resetting replies', async () => {
    const { result } = renderHook(() => useChat());
    let sending!: Promise<void>;
    act(() => {
      sending = result.current.sendMessage('First question');
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await sending;
    });
    const firstReply = result.current.messages[1].content;

    act(() => {
      sending = result.current.sendMessage('Pending follow-up');
    });
    act(() => result.current.clearMessages());

    expect(result.current.messages).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    await act(async () => {
      await sending;
    });

    act(() => {
      sending = result.current.sendMessage('New conversation');
    });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await sending;
    });
    expect(result.current.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'New conversation' },
      { role: 'assistant', content: firstReply },
    ]);
  });

  it('does not let an old reply finish or alter a new conversation', async () => {
    const { result } = renderHook(() => useChat());
    let oldSending!: Promise<void>;
    let newSending!: Promise<void>;
    act(() => {
      oldSending = result.current.sendMessage('Old conversation');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    act(() => result.current.clearMessages());
    await act(async () => {
      await oldSending;
    });
    act(() => {
      newSending = result.current.sendMessage('New conversation');
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'New conversation' },
    ]);
    expect(result.current.isLoading).toBe(true);

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
      await newSending;
    });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1].role).toBe('assistant');
    expect(result.current.isLoading).toBe(false);
  });

  it('cancels the pending reply and resolves its send promise on unmount', async () => {
    const { result, unmount } = renderHook(() => useChat());
    let sending!: Promise<void>;
    act(() => {
      sending = result.current.sendMessage('Pending question');
    });
    expect(result.current.isLoading).toBe(true);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await sending;
    });
  });
});

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

interface Position {
  anchor: { h: 'left' | 'right'; v: 'top' | 'bottom' };
  offset: { x: number; y: number };
}

const STORAGE_KEY = 'coreai-prototype-feature-selector-position';
const margin = 8;

function isPosition(value: unknown): value is Position {
  if (!value || typeof value !== 'object' || !('anchor' in value) || !('offset' in value))
    return false;
  const { anchor, offset } = value;
  return (
    !!anchor &&
    typeof anchor === 'object' &&
    'h' in anchor &&
    'v' in anchor &&
    (anchor.h === 'left' || anchor.h === 'right') &&
    (anchor.v === 'top' || anchor.v === 'bottom') &&
    !!offset &&
    typeof offset === 'object' &&
    'x' in offset &&
    'y' in offset &&
    typeof offset.x === 'number' &&
    Number.isFinite(offset.x) &&
    typeof offset.y === 'number' &&
    Number.isFinite(offset.y)
  );
}

export function useFloatingPosition() {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const latest = useRef<Position | null>(null);
  const [position, setPosition] = useState<Position | null>(null);
  const [dragging, setDragging] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);

  function move(x: number, y: number): Position | null {
    const element = ref.current;
    if (!element) return null;
    const { width, height } = element.getBoundingClientRect();
    const left = Math.max(margin, Math.min(x, window.innerWidth - width - margin));
    const top = Math.max(margin, Math.min(y, window.innerHeight - height - margin));
    const h = left + width / 2 < window.innerWidth / 2 ? 'left' : 'right';
    const v = top + height / 2 < window.innerHeight / 2 ? 'top' : 'bottom';
    const next: Position = {
      anchor: { h, v },
      offset: {
        x: h === 'left' ? left : window.innerWidth - left - width,
        y: v === 'top' ? top : window.innerHeight - top - height,
      },
    };
    latest.current = next;
    setPosition(next);
    return next;
  }

  function save(next: Position | null) {
    try {
      if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      else localStorage.removeItem(STORAGE_KEY);
      setStorageError(null);
    } catch (error) {
      console.warn('Unable to save the feature selector position.', error);
      setStorageError('Selector position changed, but could not be saved.');
    }
  }

  useEffect(() => {
    function clamp(saved: Position) {
      const element = ref.current;
      if (!element) return;
      const { width, height } = element.getBoundingClientRect();
      const x =
        saved.anchor.h === 'left' ? saved.offset.x : window.innerWidth - saved.offset.x - width;
      const y =
        saved.anchor.v === 'top' ? saved.offset.y : window.innerHeight - saved.offset.y - height;
      move(x, y);
    }
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) {
        const saved: unknown = JSON.parse(stored);
        if (!isPosition(saved)) throw new Error('Invalid saved feature selector position.');
        clamp(saved);
      }
    } catch (error) {
      console.warn('Unable to read the feature selector position.', error);
      setStorageError('The saved selector position could not be loaded.');
    }
    const resize = () => {
      if (latest.current) clamp(latest.current);
    };
    const observer = new ResizeObserver(resize);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener('resize', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, []);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    drag.current = {
      pointerId: event.pointerId,
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    setDragging(true);
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId === event.pointerId) {
      move(event.clientX - drag.current.x, event.clientY - drag.current.y);
    }
  }

  function onPointerUp() {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    save(latest.current);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!ref.current) return;
    if (event.key === 'Home') {
      event.preventDefault();
      event.stopPropagation();
      latest.current = null;
      setPosition(null);
      save(null);
      return;
    }
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const direction = directions[event.key];
    if (!direction) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = ref.current.getBoundingClientRect();
    const step = event.shiftKey ? 30 : 10;
    save(move(rect.left + direction[0] * step, rect.top + direction[1] * step));
  }

  return {
    ref,
    dragging,
    storageError,
    style: position
      ? {
          [position.anchor.h]: position.offset.x,
          [position.anchor.v]: position.offset.y,
          [position.anchor.h === 'left' ? 'right' : 'left']: 'auto',
          [position.anchor.v === 'top' ? 'bottom' : 'top']: 'auto',
          transform: 'none',
        }
      : undefined,
    dragProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onLostPointerCapture: onPointerUp,
      onKeyDown,
    },
  };
}

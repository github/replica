// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { JSX } from 'react';

import { clsx } from 'clsx';
import { useCallback, useEffect, useRef, useState } from 'react';

import styles from './ResizeHandle.module.css';

interface ResizeHandleCommonProps {
  disabled?: boolean;
  onDragStateChange?: (isDragging: boolean) => void;
}

type VerticalOrientationProps = ResizeHandleCommonProps & {
  orientation: 'vertical';
  minWidth: number;
  maxWidth: number;
  initialWidth: number;
  direction?: 'left' | 'right';
  onWidthChange: (width: number) => void;
};

type HorizontalOrientationProps = ResizeHandleCommonProps & {
  orientation: 'horizontal';
  minHeight: number;
  maxHeight: number;
  initialHeight: number;
  onHeightChange: (height: number) => void;
};

export type ResizeHandleProps = VerticalOrientationProps | HorizontalOrientationProps;

export function ResizeHandle(props: ResizeHandleProps): JSX.Element {
  const { disabled, onDragStateChange, orientation } = props;
  const isVertical = orientation === 'vertical';
  const minSize = isVertical ? props.minWidth : props.minHeight;
  const maxSize = isVertical ? props.maxWidth : props.maxHeight;
  const initialSize = isVertical ? props.initialWidth : props.initialHeight;
  const onSizeChange = isVertical ? props.onWidthChange : props.onHeightChange;
  const direction = isVertical ? (props.direction ?? 'right') : 'right';
  const [isDragging, setIsDragging] = useState(false);
  const [currentSize, setCurrentSize] = useState(initialSize);

  const dragStartPositionRef = useRef(0);
  const dragStartSizeRef = useRef(0);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) {
        return;
      }

      const currentPosition = isVertical ? e.clientX : e.clientY;
      const delta =
        direction === 'right'
          ? currentPosition - dragStartPositionRef.current
          : dragStartPositionRef.current - currentPosition;
      const newSize = Math.max(minSize, Math.min(maxSize, dragStartSizeRef.current + delta));
      setCurrentSize(newSize);
      onSizeChange(newSize);
    },
    [direction, isDragging, isVertical, maxSize, minSize, onSizeChange],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    onDragStateChange?.(false);
    document.body.style.setProperty('cursor', '');
    document.body.style.setProperty('user-select', '');
  }, [onDragStateChange]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) {
        return;
      }

      setIsDragging(true);
      onDragStateChange?.(true);
      dragStartPositionRef.current = isVertical ? e.clientX : e.clientY;
      dragStartSizeRef.current = currentSize;
      document.body.style.setProperty('cursor', isVertical ? 'col-resize' : 'ns-resize');
      document.body.style.setProperty('user-select', 'none');
    },
    [currentSize, disabled, isVertical, onDragStateChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) {
        return;
      }

      const increaseKey = isVertical ? 'ArrowRight' : 'ArrowDown';
      const decreaseKey = isVertical ? 'ArrowLeft' : 'ArrowUp';
      if (e.key !== increaseKey && e.key !== decreaseKey) {
        return;
      }

      e.preventDefault();
      const newSize =
        e.key === increaseKey
          ? Math.min(maxSize, currentSize + 10)
          : Math.max(minSize, currentSize - 10);
      setCurrentSize(newSize);
      onSizeChange(newSize);
    },
    [currentSize, disabled, isVertical, maxSize, minSize, onSizeChange],
  );

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  return (
    <div
      aria-disabled={disabled}
      aria-orientation={orientation}
      aria-valuemax={maxSize}
      aria-valuemin={minSize}
      aria-valuenow={currentSize}
      className={clsx(
        styles.resizeHandle,
        styles[orientation],
        isDragging && styles.dragging,
        disabled && styles.disabled,
      )}
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      role="separator"
      tabIndex={disabled ? -1 : 0}
    />
  );
}

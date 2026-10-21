// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { Tab } from '@coreai-ds/react-components';
import { clsx } from 'clsx';
import { forwardRef, useMemo, useRef } from 'react';

import styles from './TabRadio.module.css';

export interface TabRadioProps {
  value: string;
  name: string;
  checked: boolean;
  onChange: (value: string) => void;
  disabled?: boolean;
  children?: ReactNode;
}

type RadioTabSlotProps = ComponentPropsWithoutRef<'button'> & {
  as?: unknown;
  appearance?: unknown;
};

/**
 * Renders Fluent's real `Tab` with a native radio `input` slotted in as its root, via
 * the same slot-injection/type-cast technique `TabLink` uses for a router `NavLink`.
 * The slot itself is a `label` (not the `input` directly) because `Tab`'s `content`
 * slot is rendered as a *child* of the root, and `input` is a void element that can't
 * have children - the `label` wraps the hidden `input` alongside Tab's own rendered
 * label text, exactly like `Radio` does internally. `checked` is passed in rather than
 * derived from Tab's own `aria-selected` styling (an internal state Tab doesn't expose) -
 * `TabRadioGroup` derives both this and the `TabList`'s `selectedValue` from the same
 * source of truth so the native radio state and Tab's own selected styling stay in sync.
 *
 * This is used as a form control, so the native input remains the focusable semantic
 * radio and owns the browser's built-in radio keyboard behavior. `Tab`'s generated
 * `role="tab"`/`aria-selected` are cleared from the wrapping label; Tab and TabList are
 * retained for their visual styling and selected-state appearance only.
 */
export function TabRadio({
  value,
  name,
  checked,
  onChange,
  disabled,
  children,
}: TabRadioProps): JSX.Element {
  const inputState = useRef({ checked, disabled, name, onChange, value });
  inputState.current = { checked, disabled, name, onChange, value };

  const RadioTabSlot = useMemo(() => {
    return forwardRef<HTMLLabelElement, RadioTabSlotProps>(
      (
        {
          as: _as,
          appearance: _appearance,
          children: content,
          disabled: _disabled,
          type: _type,
          value: _value,
          ...labelProps
        },
        forwardedRef,
      ) => (
        <label ref={forwardedRef} {...(labelProps as ComponentPropsWithoutRef<'label'>)}>
          <input
            checked={inputState.current.checked}
            className={clsx('fui-TabRadio__input', styles.input)}
            disabled={inputState.current.disabled}
            name={inputState.current.name}
            onChange={() => inputState.current.onChange(inputState.current.value)}
            type="radio"
            value={inputState.current.value}
          />
          {content}
        </label>
      ),
    );
  }, []);

  return (
    <Tab
      // Fluent's `as` is typed as "button" only, but the runtime slot resolver accepts
      // any component - cast past the type restriction rather than patching Fluent.
      as={RadioTabSlot as unknown as 'button'}
      // The native input owns radio semantics; clear Tab semantics from the wrapping label.
      aria-selected={undefined}
      className={clsx('fui-TabRadio', styles.tab)}
      data-tabster={undefined}
      disabled={disabled}
      role={undefined}
      value={value}
    >
      {children}
    </Tab>
  );
}

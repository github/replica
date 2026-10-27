// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type {
  TabListAppearance,
  TabListProps as CoreAITabListProps,
} from '@coreai-ds/react-components';
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react';

import { TabList as FluentTabList } from '@coreai-ds/react-components';
import { clsx } from 'clsx';
import { forwardRef, useId } from 'react';

import { TabRadio } from '../TabRadio/TabRadio';
import styles from './TabRadioGroup.module.css';

type RadioGroupSlotProps = ComponentPropsWithoutRef<'div'> & {
  as?: unknown;
  appearance?: unknown;
  reserveSelectedTabSpace?: unknown;
  size?: unknown;
};

const RadioGroupSlot = forwardRef<HTMLDivElement, RadioGroupSlotProps>(
  (
    {
      as: _as,
      appearance: _appearance,
      reserveSelectedTabSpace: _reserveSelectedTabSpace,
      size: _size,
      ...divProps
    },
    forwardedRef,
  ) => <div ref={forwardedRef} {...divProps} />,
);

export interface TabRadioGroupProps<T extends string> extends Omit<
  CoreAITabListProps,
  'children' | 'onChange' | 'onTabSelect' | 'selectedValue'
> {
  'aria-label': string;
  appearance?: TabListAppearance;
  className?: string;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  selectedValue: T;
  onChange: (value: T) => void;
}

/**
 * A row of tab-styled radio options: renders Fluent's real `TabList`/`Tab`, each `Tab`
 * with a native radio `input` slotted in via `TabRadio` (see there for why `Tab` can't
 * be reused the way `TabLink` reuses it without a slotted native control). Selection is
 * driven by `selectedValue`/`onChange`, which feed both the `TabList`'s own
 * `selectedValue` (so Tab's built-in selected/hover/appearance styling applies
 * unmodified) and each `TabRadio`'s `checked` state (so the underlying radios stay in
 * sync, sharing one generated `name` so they behave as a real mutually exclusive group).
 *
 * Used as a form control, so `TabList`'s own `role="tablist"` is overridden to
 * `role="radiogroup"` (Fluent merges consumer-passed `role` over its own default, so no
 * internal `TabList` code needs to change). Each `TabRadio` clears Tab semantics from
 * its wrapping label and leaves focus, radio semantics, and keyboard behavior to the
 * slotted native input.
 */
export function TabRadioGroup<T extends string>({
  'aria-label': ariaLabel,
  appearance,
  className,
  options,
  selectedValue,
  onChange,
  ...props
}: TabRadioGroupProps<T>): JSX.Element {
  const name = useId();

  return (
    <FluentTabList
      {...props}
      appearance={appearance}
      aria-label={ariaLabel}
      as={RadioGroupSlot as unknown as 'div'}
      className={clsx(styles.tabList, appearance === 'elevated' && styles.elevated, className)}
      data-tabster={undefined}
      role="radiogroup"
      selectedValue={selectedValue}
    >
      {options.map((option) => (
        <TabRadio
          key={option.value}
          checked={selectedValue === option.value}
          disabled={option.disabled}
          name={name}
          onChange={(value) => onChange(value as T)}
          value={option.value}
        >
          {option.label}
        </TabRadio>
      ))}
    </FluentTabList>
  );
}

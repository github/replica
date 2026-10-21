// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { CardProps as CoreAICardProps } from '@coreai-ds/react-components';
import type { ComponentPropsWithoutRef, JSX, Ref } from 'react';
import type { LinkProps as RouterLinkProps } from 'react-router';

import { Card as CoreAICard } from '@coreai-ds/react-components';
import { clsx } from 'clsx';
import { forwardRef, useMemo } from 'react';
import { Link as RouterLink } from 'react-router';

import styles from './Card.module.css';

type CardCommonProps = Pick<
  CoreAICardProps,
  'children' | 'className' | 'appearance' | 'size' | 'orientation'
>;

interface CardClickableProps {
  disabled?: boolean;
  disabledFocusable?: boolean;
  selected?: undefined;
}

export type CardButtonProps = CardClickableProps &
  Omit<ComponentPropsWithoutRef<'button'>, 'children' | 'className' | 'disabled' | 'type'> &
  CardCommonProps & {
    type: 'button';
    ref?: Ref<HTMLButtonElement>;
  };

export type CardLinkProps = CardClickableProps &
  Omit<RouterLinkProps, 'children' | 'className' | 'to'> &
  CardCommonProps & {
    type: 'link';
    to: RouterLinkProps['to'];
    ref?: Ref<HTMLAnchorElement>;
  };

export type CardSelectableProps = CoreAICardProps &
  CardCommonProps & {
    type: 'selectable';
    disabled?: boolean;
  };

export type CardStaticProps = Omit<
  CoreAICardProps,
  'onClick' | 'onKeyDown' | 'tabIndex' | 'selected' | 'defaultSelected' | 'onSelectionChange'
> &
  CardCommonProps & {
    type?: undefined;
    disabled?: undefined;
    selected?: undefined;
  };

export type CardProps = CardButtonProps | CardLinkProps | CardStaticProps | CardSelectableProps;

type NativeButtonCardSlotProps = ComponentPropsWithoutRef<'button'> & {
  as?: unknown;
  'data-native-disabled'?: 'true';
};
type RouterCardSlotProps = ComponentPropsWithoutRef<'a'> & {
  as?: unknown;
  disabled?: boolean;
};

const markCardInteractive = (): void => undefined;

const NativeButtonCardSlot = forwardRef<HTMLButtonElement, NativeButtonCardSlotProps>(
  (
    {
      as: _as,
      disabled: _cardDisabled,
      'data-native-disabled': nativeDisabled,
      type: _type,
      ...slotProps
    },
    forwardedRef,
  ) => (
    <button {...slotProps} ref={forwardedRef} disabled={nativeDisabled === 'true'} type="button" />
  ),
);

function CardLink({
  to,
  disabled,
  disabledFocusable,
  children,
  className,
  onClick,
  prefetch = 'intent',
  preventScrollReset,
  relative,
  reloadDocument,
  replace,
  state,
  viewTransition = true,
  ...props
}: Omit<CardLinkProps, 'type'>): JSX.Element {
  const RouterCardSlot = useMemo(() => {
    return forwardRef<HTMLAnchorElement, RouterCardSlotProps>(
      ({ as: _as, disabled: _cardDisabled, onClick, ...slotProps }, forwardedRef) => (
        <RouterLink
          {...slotProps}
          ref={forwardedRef}
          onClick={(event) => {
            if (disabled || disabledFocusable) {
              event.preventDefault();
              return;
            }

            onClick?.(event);
          }}
          prefetch={prefetch}
          preventScrollReset={preventScrollReset}
          relative={relative}
          reloadDocument={reloadDocument}
          replace={replace}
          state={state}
          to={disabled || disabledFocusable ? '#' : to}
          viewTransition={viewTransition}
        />
      ),
    );
  }, [
    disabled,
    disabledFocusable,
    prefetch,
    preventScrollReset,
    relative,
    reloadDocument,
    replace,
    state,
    to,
    viewTransition,
  ]);

  return (
    <CoreAICard
      as={RouterCardSlot as unknown as 'div'}
      aria-disabled={disabled || disabledFocusable || undefined}
      className={clsx(styles.linkReset, className)}
      disabled={disabled || disabledFocusable}
      onClick={(onClick ?? markCardInteractive) as unknown as CoreAICardProps['onClick']}
      role={undefined}
      tabIndex={disabled ? -1 : undefined}
      {...(props as CoreAICardProps)}
    >
      {children}
    </CoreAICard>
  );
}

function CardButton({
  disabled,
  disabledFocusable,
  children,
  className,
  onClick,
  ...props
}: Omit<CardButtonProps, 'type'>): JSX.Element {
  return (
    <CoreAICard
      as={NativeButtonCardSlot as unknown as 'div'}
      aria-disabled={disabled || disabledFocusable || undefined}
      className={clsx(styles.buttonReset, className)}
      data-native-disabled={disabled ? 'true' : undefined}
      disabled={disabled || disabledFocusable}
      onClick={(onClick ?? markCardInteractive) as unknown as CoreAICardProps['onClick']}
      role={undefined}
      tabIndex={disabled ? -1 : undefined}
      {...(props as CoreAICardProps)}
    >
      {children}
    </CoreAICard>
  );
}

export function Card({
  type,
  className,
  children,
  disabled,
  appearance,
  size,
  orientation,
  ...rest
}: CardProps): JSX.Element {
  const isDisabledFocusable = 'disabledFocusable' in rest && rest.disabledFocusable;

  const cardProps = rest as Partial<CardStaticProps | CardSelectableProps>;

  if (type === undefined || type === 'selectable') {
    return (
      <CoreAICard
        appearance={appearance}
        className={className}
        disabled={disabled}
        orientation={orientation}
        size={size}
        {...cardProps}
      >
        {children}
      </CoreAICard>
    );
  }

  if (type === 'link') {
    return (
      <CardLink
        {...(rest as Omit<CardLinkProps, 'type'>)}
        appearance={appearance}
        className={className}
        disabled={disabled}
        disabledFocusable={isDisabledFocusable}
        orientation={orientation}
        size={size}
      >
        {children}
      </CardLink>
    );
  }

  return (
    <CardButton
      {...(rest as Omit<CardButtonProps, 'type'>)}
      appearance={appearance}
      className={className}
      disabled={disabled}
      disabledFocusable={isDisabledFocusable}
      orientation={orientation}
      size={size}
    >
      {children}
    </CardButton>
  );
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ComponentPropsWithoutRef } from 'react';
import type {
  LinkProps as RouterLinkProps,
  NavLinkProps as RouterNavLinkProps,
} from 'react-router';
import type { LinkProps as CoreAILinkProps } from '@coreai-ds/react-components';

import { Link as CoreAILink } from '@coreai-ds/react-components';
import { forwardRef, useMemo } from 'react';
import { Link as RouterLink, NavLink as RouterNavLink } from 'react-router';

interface LinkBaseProps {
  className?: string;
  isNavLink?: boolean;
  /**
   * Inline appearance adds underline, required for accessibility so links are distinguishable from regular text when in a paragraph.
   */
  appearance?: 'normal' | 'inline';
  ref?: React.Ref<HTMLAnchorElement>;
}

export type NavLinkProps = LinkBaseProps &
  Omit<RouterNavLinkProps, 'className'> & {
    isNavLink: true;
  };

export type RegularLinkProps = LinkBaseProps &
  Omit<RouterLinkProps, 'className'> & {
    isNavLink?: false;
  };

export type LinkProps = NavLinkProps | RegularLinkProps;

export type ExternalLinkProps = Omit<ComponentPropsWithoutRef<'a'>, 'href' | 'ref'> &
  Pick<CoreAILinkProps, 'appearance' | 'disabled' | 'disabledFocusable' | 'inline'> & {
    href: string;
  };

export function ExternalLink({ href, ...props }: ExternalLinkProps): React.ReactElement {
  return <CoreAILink external href={href} {...props} />;
}

export function Link({
  isNavLink = false,
  prefetch = 'intent',
  viewTransition = true,
  onClick,
  className,
  appearance = 'normal',
  ref,
  ...rest
}: LinkProps): React.ReactElement {
  // Check for external links in development mode
  if (import.meta.env.DEV) {
    const to = 'to' in rest ? rest.to : '';

    if (typeof to === 'string' && (to.startsWith('http://') || to.startsWith('https://'))) {
      throw new Error(
        'External links should use CoreAI Link with external={true} instead of the Router Link adapter',
      );
    }
  }

  const { to, replace, state, relative, preventScrollReset, end, caseSensitive, ...linkProps } =
    rest as NavLinkProps;

  // CoreAI's `Link` (like Fluent's) filters unrecognized props down to plain DOM
  // attributes before they reach its rendered element, so React Router props (`to`,
  // `replace`, etc.) can't be passed through as top-level props - they'd be stripped.
  // Instead we bake them into a small `as` component via closure, so only ordinary DOM
  // props (className, onClick, aria-*, children) need to survive that filtering.
  const RouterLinkSlot = useMemo(() => {
    return forwardRef<HTMLAnchorElement, ComponentPropsWithoutRef<'a'>>(
      (slotProps, forwardedRef) =>
        isNavLink ? (
          <RouterNavLink
            ref={forwardedRef}
            caseSensitive={caseSensitive}
            end={end}
            preventScrollReset={preventScrollReset}
            prefetch={prefetch}
            relative={relative}
            replace={replace}
            state={state}
            to={to}
            viewTransition={viewTransition}
            {...slotProps}
          />
        ) : (
          <RouterLink
            ref={forwardedRef}
            preventScrollReset={preventScrollReset}
            prefetch={prefetch}
            relative={relative}
            replace={replace}
            state={state}
            to={to}
            viewTransition={viewTransition}
            {...slotProps}
          />
        ),
    );
  }, [
    isNavLink,
    to,
    replace,
    state,
    relative,
    preventScrollReset,
    viewTransition,
    prefetch,
    end,
    caseSensitive,
  ]);

  return (
    <CoreAILink
      {...(linkProps as ComponentPropsWithoutRef<'a'>)}
      ref={ref}
      // Fluent's `as` is typed as 'a' | 'button' | 'span', but the runtime slot resolver
      // accepts any component - cast past the type restriction rather than patching Fluent.
      as={RouterLinkSlot as unknown as 'a'}
      inline={appearance === 'inline'}
      className={className}
      onClick={onClick}
    >
      {linkProps.children}
    </CoreAILink>
  );
}

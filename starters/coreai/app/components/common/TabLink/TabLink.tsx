// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ComponentPropsWithoutRef, JSX, MouseEventHandler, ReactNode, Ref } from 'react';

import { Tab } from '@coreai-ds/react-components';
import { clsx } from 'clsx';
import { forwardRef, useMemo } from 'react';
import { NavLink as RouterNavLink, useLocation } from 'react-router';

import styles from './TabLink.module.css';

export interface TabLinkProps {
  to: string;
  end?: boolean;
  preventScrollReset?: boolean;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  children?: ReactNode;
}

/**
 * Renders Fluent's real `Tab` with a router `NavLink` slotted in as its root, via the
 * same slot-injection/type-cast technique as `Link.tsx`. Fluent only types/documents
 * Tab's `as` as `"button"` - this relies on the runtime slot resolver accepting any
 * component, unverified against edge cases in Tabster's roving-tabindex/keydown handling
 * or a future `disabled` tab (anchors have no native `disabled`; see `LinkButton.tsx` for
 * how that's hand-emulated elsewhere).
 */
export function TabLink({
  to,
  end,
  preventScrollReset,
  onClick,
  children,
}: TabLinkProps): JSX.Element {
  const RouterTabSlot = useMemo(() => {
    return forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<'button'>>(
      function RouterTabRoot(slotProps, forwardedRef) {
        const location = useLocation();
        const hasQuery = to.includes('?');
        const queryActive = isLinkSelected(to, end, location.pathname, location.search);
        const anchorProps = slotProps as unknown as ComponentPropsWithoutRef<'a'>;

        return (
          <RouterNavLink
            ref={forwardedRef as unknown as Ref<HTMLAnchorElement>}
            end={end}
            to={to}
            preventScrollReset={preventScrollReset}
            {...anchorProps}
            onClick={(event) => {
              onClick?.(event);
              if (!event.defaultPrevented) {
                anchorProps.onClick?.(event);
              }
            }}
            aria-current={hasQuery ? (queryActive ? 'page' : false) : slotProps['aria-current']}
            className={({ isActive }) =>
              clsx(slotProps.className, (hasQuery ? queryActive : isActive) && 'active')
            }
          />
        );
      },
    );
  }, [to, end, preventScrollReset, onClick]);

  return (
    <Tab
      // Fluent's `as` is typed as "button" only, but the runtime slot resolver accepts
      // any component - cast past the type restriction rather than patching Fluent.
      as={RouterTabSlot as unknown as 'button'}
      className={clsx('fui-TabLink', styles.tab)}
      value={to}
    >
      {children}
    </Tab>
  );
}

/**
 * Matches NavLink-style pathnames and, when supplied, the destination's query values.
 * Repeated query values are compared without order so variant links can be active
 * independently on the same pathname. Absolute paths (leading `/`) are compared
 * against the full pathname with the same segment-boundary check `NavLink` uses -
 * `matchPath`'s `end: false` treats `"/"` as a prefix of *every* path, which would make
 * a root link permanently "active". Relative paths (e.g. sibling tab routes like
 * `"playground"`) are resolved by `NavLink` against the *current route*, not
 * `location.pathname` directly, so a plain `matchPath(to, location.pathname)` never
 * matches them - approximate that resolution by comparing `to` against the matching
 * number of trailing path segments instead.
 */
export function isLinkSelected(
  to: string,
  end: boolean | undefined,
  pathname: string,
  search = '',
): boolean {
  const targetPath = to.split(/[?#]/, 1)[0];
  const toSegments = targetPath.split('/').filter(Boolean);
  const pathSegments = pathname.split('/').filter(Boolean);
  const pathMatches = targetPath.startsWith('/')
    ? pathname === targetPath ||
      (!(end ?? false) &&
        pathname.startsWith(targetPath) &&
        pathname.charAt(targetPath.length) === '/')
    : pathSegments.slice(-toSegments.length).join('/') === targetPath;
  if (!pathMatches) return false;

  if (!to.includes('?')) return true;
  const targetQuery = new URLSearchParams(to.slice(to.indexOf('?') + 1).split('#', 1)[0]);
  const currentQuery = new URLSearchParams(search);
  return [...new Set(targetQuery.keys())].every((key) => {
    const expected = targetQuery.getAll(key).sort();
    const actual = currentQuery.getAll(key).sort();
    return (
      expected.length === actual.length && expected.every((value, index) => value === actual[index])
    );
  });
}

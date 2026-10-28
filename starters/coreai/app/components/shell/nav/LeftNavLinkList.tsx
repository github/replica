// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { JSX } from 'react';
import { useId } from 'react';
import { Text, Tooltip } from '@coreai-ds/react-components';
import { clsx } from 'clsx';
import { Link } from '~/components/common';
import type { LeftNavRoute } from '~/routes';
import styles from './LeftNav.module.css';

export interface LeftNavLinkListProps {
  routes: LeftNavRoute[];
  isCollapsed?: boolean;
  onNavigate?: () => void;
  className?: string;
}

export function LeftNavLinkList({
  routes,
  isCollapsed = false,
  onNavigate,
  className,
}: LeftNavLinkListProps): JSX.Element {
  const headingId = useId();
  const groups: { title?: string; routes: LeftNavRoute[] }[] = [];

  for (const route of routes) {
    if (route.sectionTitle || groups.length === 0) {
      groups.push({ title: route.sectionTitle, routes: [] });
    }
    groups[groups.length - 1].routes.push(route);
  }

  return (
    <div className={clsx(styles.linkGroups, className)}>
      {groups.map((group, groupIndex) => (
        <div className={styles.linkGroup} key={group.routes[0].path}>
          {group.title && (
            <Text
              as="h2"
              id={`${headingId}-${groupIndex}`}
              preset="bodySStrong"
              foreground={3}
              className={styles.sectionTitle}
            >
              <span>{group.title}</span>
            </Text>
          )}
          <ul
            className={styles.linkList}
            aria-labelledby={group.title ? `${headingId}-${groupIndex}` : undefined}
          >
            {group.routes.map((route) => {
              const { regular: RegularIcon, selected: SelectedIcon } = route.icon;
              const link = (
                <Link
                  className={styles.navLink}
                  isNavLink={true}
                  onClick={onNavigate}
                  to={route.path}
                >
                  <RegularIcon aria-hidden={true} className={styles.regularIcon} />
                  <SelectedIcon aria-hidden={true} className={styles.selectedIcon} />
                  <span className={styles.navLinkText}>{route.content}</span>
                </Link>
              );

              return (
                <li key={route.path}>
                  {isCollapsed ? (
                    <Tooltip
                      content={route.content}
                      positioning="after"
                      relationship="label"
                      showDelay={150}
                    >
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

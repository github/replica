// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { JSX } from 'react';

import { clsx } from 'clsx';
import { useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { useContainerQuery } from '~/components/common';

import styles from './LeftNav.module.css';
import { Button } from '@coreai-ds/react-components';
import { PanelLeftExpandRegular, PanelRightExpandRegular } from '@fluentui/react-icons';
import { getLeftNavRoutes } from '~/routes';
import { LeftNavLinkList } from '~/components/shell/nav/LeftNavLinkList';

export interface LeftNavProps {
  className?: string;
}

export function LeftNav({ className }: LeftNavProps): JSX.Element | null {
  const location = useLocation();
  const [collapsedSetting, setCollapsedSetting] = useState<boolean | 'initial'>('initial');
  const initialCollapsed = useContainerQuery('(max-width: 1024px)');
  const isCollapsed: boolean = collapsedSetting === 'initial' ? initialCollapsed : collapsedSetting;

  const leftNavRoutes = useMemo(() => getLeftNavRoutes(location.pathname), [location.pathname]);

  return leftNavRoutes.length > 0 ? (
    <nav className={clsx(styles.leftNav, isCollapsed && styles.collapsed, className)}>
      <LeftNavLinkList
        routes={leftNavRoutes.filter((route) => route.placement !== 'bottom')}
        isCollapsed={isCollapsed}
        className={styles.mainLinks}
      />
      <div className={styles.bottomSection}>
        {leftNavRoutes.some((route) => route.placement === 'bottom') && (
          <LeftNavLinkList
            routes={leftNavRoutes.filter((route) => route.placement === 'bottom')}
            isCollapsed={isCollapsed}
          />
        )}
        <div className={styles.expanderContainer}>
          <Button
            appearance="subtle"
            aria-label={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
            data-testid="collapse-toggle-button"
            icon={
              isCollapsed ? (
                <PanelLeftExpandRegular aria-hidden={true} />
              ) : (
                <PanelRightExpandRegular aria-hidden={true} />
              )
            }
            onClick={() => {
              setCollapsedSetting(!isCollapsed);
            }}
          />
        </div>
      </div>
    </nav>
  ) : null;
}

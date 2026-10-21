// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { JSX } from 'react';

import {
  Button,
  Drawer,
  DrawerBody,
  useRestoreFocusSource,
  useRestoreFocusTarget,
} from '@coreai-ds/react-components';
import { TabLinkList } from '~/components/common';
import { NavigationRegular, PanelLeftContractRegular } from '@fluentui/react-icons';
import { useMemo } from 'react';
import { useLocation } from 'react-router';

import { getLeftNavRoutes } from '~/routes';
import { LeftNavLinkList } from './LeftNavLinkList';

import leftNavStyles from './LeftNav.module.css';
import styles from './MobileLeftNav.module.css';

export interface MobileLeftNavProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  topNavRoutes: {
    path: string;
    content: string;
  }[];
  buttonClassname?: string;
  buttonsAboveNav?: JSX.Element;
}

export function MobileLeftNav({
  isOpen,
  setIsOpen,
  topNavRoutes,
  buttonClassname,
  buttonsAboveNav,
}: MobileLeftNavProps): JSX.Element {
  const location = useLocation();

  const leftNavRoutes = useMemo(() => getLeftNavRoutes(location.pathname), [location.pathname]);

  const restoreFocusTargetAttributes = useRestoreFocusTarget();
  const restoreFocusSourceAttributes = useRestoreFocusSource();

  return (
    <>
      <Button
        {...restoreFocusTargetAttributes}
        appearance="subtle"
        aria-label="Menu"
        className={buttonClassname}
        icon={<NavigationRegular aria-hidden={true} />}
        onClick={() => {
          setIsOpen(true);
        }}
      />

      <Drawer
        {...restoreFocusSourceAttributes}
        aria-label="Navigation menu"
        className={styles.drawer}
        modalType="modal"
        onOpenChange={(_, { open }) => {
          setIsOpen(open);
        }}
        open={isOpen}
        position="start"
      >
        <DrawerBody className={styles.body}>
          {/* Action buttons */}
          <div className={styles.iconsAboveNav}>{buttonsAboveNav}</div>
          {/* Top Navigation Tabs */}
          <div className={styles.topNav}>
            <TabLinkList
              alignContent={false}
              appearance="elevated"
              aria-label="Top navigation"
              links={topNavRoutes.map((route) => ({
                label: route.content,
                to: route.path,
                onClick() {
                  setIsOpen(false);
                },
              }))}
              size="medium"
            />
          </div>

          {/* Left Navigation Links */}
          <nav aria-label="Left navigation">
            <LeftNavLinkList
              routes={leftNavRoutes.filter((route) => route.placement !== 'bottom')}
              className={styles.linkList}
              onNavigate={() => setIsOpen(false)}
            />
          </nav>
        </DrawerBody>
        <div className={leftNavStyles.bottomSection}>
          {leftNavRoutes.some((route) => route.placement === 'bottom') && (
            <nav aria-label="Bottom navigation">
              <LeftNavLinkList
                routes={leftNavRoutes.filter((route) => route.placement === 'bottom')}
                onNavigate={() => setIsOpen(false)}
              />
            </nav>
          )}
          <div className={leftNavStyles.expanderContainer}>
            <Button
              appearance="subtle"
              aria-label="Collapse menu"
              icon={<PanelLeftContractRegular aria-hidden="true" />}
              onClick={() => setIsOpen(false)}
              size="small"
            />
          </div>
        </div>
      </Drawer>
    </>
  );
}

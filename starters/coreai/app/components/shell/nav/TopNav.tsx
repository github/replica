// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { JSX } from 'react';
import { useEffect, useState } from 'react';
import { Text } from '@coreai-ds/react-components';
import { CoreAILogo, Link } from '~/components/common';
import styles from './TopNav.module.css';
import { ProfileButton } from './profile/ProfileButton';
import { ProjectSwitcher } from './ProjectSwitcher';
import { SlashForward12Regular } from '@fluentui/react-icons';
import { FeedbackButton } from '../feedback/FeedbackButton';
import { NotificationButton } from '../notifications/NotificationButton';
import { SearchButton } from '../search/SearchButton';
import { SearchDialog } from '../search/SearchDialog';
import { AgentHelperToggleButton } from './AgentHelperToggleButton';
import { topNavRoutes } from '~/routes';
import { MobileLeftNav } from './MobileLeftNav';
import { FeatureMenu } from '~/features/FeatureMenu';

export function TopNav(): JSX.Element {
  const [isSearchDialogOpen, setIsSearchDialogOpen] = useState(false);
  const [isMobileLeftNavOpen, setIsMobileLeftNavOpen] = useState(false);

  useEffect(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        event.shiftKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 'k'
      ) {
        return;
      }
      event.preventDefault();
      setIsSearchDialogOpen(true);
    };
    window.addEventListener('keydown', handleSearchShortcut);
    return () => window.removeEventListener('keydown', handleSearchShortcut);
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.leftSection}>
        <div className={styles.brand}>
          <Link
            className={styles.brandLink}
            to={'/'} //{logoPathToNavigate}
          >
            <div className={styles.logoWrapper}>
              <CoreAILogo />
            </div>
            <Text preset="body" foreground={2} className={styles.appName}>
              CoreAI Sandbox
            </Text>
          </Link>
          <FeatureMenu />
        </div>
        <SlashForward12Regular aria-hidden={true} className={styles.breadCrumbDivider} />
        <ProjectSwitcher />
      </div>

      <div className={styles.centerSection}>
        <SearchButton
          className={styles.largeSearchButton}
          onClick={() => setIsSearchDialogOpen(true)}
          appearance="secondary"
        >
          <Text preset="body" foreground={2} className={styles.searchButtonText}>
            <Text preset="body" foreground={3}>
              Search with AI
            </Text>
            <Text preset="bodyS" foreground={4}>
              ⌘ K
            </Text>
          </Text>
        </SearchButton>
        <AgentHelperToggleButton className={styles.searchAgentHelperButton} />{' '}
      </div>

      <div className={styles.rightSection}>
        <div className={styles.linkContainer} data-testid="top-nav-links">
          {topNavRoutes.map((route) => (
            <Link key={route.path} className={styles.navLink} isNavLink={true} to={route.path}>
              {route.content}
            </Link>
          ))}
        </div>

        <div className={styles.buttonsContainer}>
          <SearchButton
            className={styles.smallSearchButton}
            onClick={() => setIsSearchDialogOpen(true)}
          />

          <AgentHelperToggleButton className={styles.agentHelperButtonWithGlobalSearch} />

          <NotificationButton className={styles.notificationButton} />

          <FeedbackButton className={styles.feedbackButton} />

          <ProfileButton />

          <MobileLeftNav
            buttonClassname={styles.menuButton}
            buttonsAboveNav={
              <>
                <SearchButton
                  className={styles.smallSearchButton}
                  onClick={() => setIsSearchDialogOpen(true)}
                />{' '}
                <AgentHelperToggleButton />
                <NotificationButton />
                <FeedbackButton />
              </>
            }
            isOpen={isMobileLeftNavOpen}
            setIsOpen={setIsMobileLeftNavOpen}
            topNavRoutes={topNavRoutes}
          />
        </div>
      </div>

      <SearchDialog isOpen={isSearchDialogOpen} onClose={() => setIsSearchDialogOpen(false)} />
    </div>
  );
}

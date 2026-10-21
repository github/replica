// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { JSX } from 'react';
import {
  Avatar,
  Button,
  Divider,
  Persona,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Text,
} from '@coreai-ds/react-components';
import { Link } from '~/components/common';

import styles from './ProfileButton.module.css';
import { ArrowExit20Regular } from '@fluentui/react-icons';
import { ThemePicker } from './ThemePicker';
import { AzureOpenAISettingsDialog } from './AzureOpenAISettingsDialog';
import { useUserInfo } from '~/hooks/useUserInfo';

export function ProfileButton(): JSX.Element {
  const { data: userInfo, isLoading } = useUserInfo();
  return (
    <Popover
      positioning={{
        position: 'below',
        align: 'end',
        strategy: 'fixed',
        offset: { mainAxis: 8, crossAxis: 0 },
      }}
      trapFocus={true}
    >
      <PopoverTrigger disableButtonEnhancement>
        <Button
          appearance="subtle"
          icon={
            <Avatar
              // image={{ src: profileImageSrc, alt: '' }}
              role="presentation" // Override default img because alt text is always empty
              size={24}
            />
          }
        />
      </PopoverTrigger>

      <PopoverSurface>
        <div className={styles.content}>
          <Text foreground={1} as="h1" preset="heading4">
            Profile
          </Text>
          <Persona
            avatar={{ size: 48 }}
            className={styles.persona}
            primaryText={
              <Text foreground={1} preset="heading4">
                {isLoading ? 'Loading...' : userInfo?.userDetails || 'User Name'}
              </Text>
            }
            secondaryText={
              <Text preset="body" foreground={2}>
                {isLoading ? '...' : userInfo?.identityProvider || 'Unknown'}
              </Text>
            }
          />
          <Text foreground={1} as="h2" preset="heading4">
            Settings
          </Text>
          <ThemePicker className={styles.dropdownContainer} />
          <AzureOpenAISettingsDialog className={styles.settingsButton} />
          {/* <LanguagePicker
            className={styles.dropdownContainer}
            onPendingChange={setPendingLanguage}
            pendingLanguage={pendingLanguage}
          /> */}
          <Divider />
          <Link
            className={styles.signOut}
            to={'/.auth/logout'} //{`/${routePrefix}/auth/logout`}
            reloadDocument
          >
            <ArrowExit20Regular /> Sign out
          </Link>
        </div>
      </PopoverSurface>
    </Popover>
  );
}

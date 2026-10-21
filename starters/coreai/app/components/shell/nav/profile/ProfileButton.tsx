// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { JSX } from 'react';
import {
  Avatar,
  Button,
  Persona,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  Text,
} from '@coreai-ds/react-components';

import styles from './ProfileButton.module.css';
import { ThemePicker } from './ThemePicker';
import { AzureOpenAISettingsDialog } from './AzureOpenAISettingsDialog';

export function ProfileButton(): JSX.Element {
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
          aria-label="Profile"
          appearance="subtle"
          icon={
            <Avatar
              role="presentation"
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
                User Name
              </Text>
            }
            secondaryText={
              <Text preset="body" foreground={2}>
                Prototype user
              </Text>
            }
          />
          <Text foreground={1} as="h2" preset="heading4">
            Settings
          </Text>
          <ThemePicker className={styles.dropdownContainer} />
          <AzureOpenAISettingsDialog className={styles.settingsButton} />
        </div>
      </PopoverSurface>
    </Popover>
  );
}

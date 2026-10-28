// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { JSX } from 'react';

import {
  Menu,
  MenuButton,
  MenuDivider,
  MenuGroupHeader,
  MenuItem,
  MenuItemRadio,
  MenuList,
  MenuPopover,
  MenuTrigger,
} from '@coreai-ds/react-components';
import { ChevronUpDownRegular, Open12Regular } from '@fluentui/react-icons';
import styles from './ProjectSwitcher.module.css';

export function ProjectSwitcher(): JSX.Element {
  const currentWorkspaceName = 'My Project';

  return (
    <>
      <Menu>
        <MenuTrigger>
          <MenuButton
            appearance="subtle"
            className={styles.menuButton}
            menuIcon={<ChevronUpDownRegular aria-hidden={true} />}
          >
            <span className={styles.menuButtonText}>{currentWorkspaceName}</span>
          </MenuButton>
        </MenuTrigger>

        <MenuPopover className={styles.menuPopover}>
          <MenuList>
            <MenuGroupHeader>Recent Projects</MenuGroupHeader>
            <MenuItemRadio name={''} value={''} secondaryContent={'westus'}>
              Project Alpha
            </MenuItemRadio>
            <MenuItemRadio name={''} value={''} secondaryContent={'eastus'}>
              Project Beta
            </MenuItemRadio>
            <MenuDivider />
            <MenuItem>View All Projects</MenuItem>
            <MenuItem>Create New Project</MenuItem>
            <MenuDivider />
            <MenuItem secondaryContent={<Open12Regular aria-hidden={true} />}>
              View All Resources
            </MenuItem>
          </MenuList>
        </MenuPopover>
      </Menu>
    </>
  );
}

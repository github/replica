// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { TableColumnDefinition } from '../DataGridWithFilters';
import type { ReactNode } from 'react';

import {
  Menu,
  MenuButton,
  MenuList,
  MenuPopover,
  MenuTrigger,
  useRestoreFocusTarget,
} from '@coreai-ds/react-components';
import { MoreVerticalRegular } from '@fluentui/react-icons';

import styles from './createMenuColumn.module.css';

interface MenuColumnOptions<T = never> {
  /** Unique column ID must be unique for the table. Default to 'actions'; use a different ID if your table already has a column with this ID. */
  columnId?: string;
  /** Render MenuItem, MenuDivider, or MenuGroup children for that row. */
  renderMenuItems: (item: T) => ReactNode;
  /** Generate a unique accessible label for each row. Must be a localized string. Example: "Actions for MyAgent" */
  getLabel: (item: T) => string;
  /** Hidden accessible label for the column. Must be a localized string. If not provided, defaults to "Actions"  */
  headingLabel?: string;
  /** Should be true if any of the menu items can open a dialog */
  isDialogTrigger?: boolean;
}

function HeaderCell({ label }: { label?: string }) {
  return <span className={styles.menuHeader}>{label ?? 'Actions'}</span>;
}

const noopComparator = () => 0;

interface MenuCellProps<T> {
  getLabel: (item: T) => string;
  isDialogTrigger?: boolean;
  item: T;
  renderMenuItems: (item: T) => ReactNode;
}

function MenuCell<T>({ getLabel, isDialogTrigger, item, renderMenuItems }: MenuCellProps<T>) {
  const focusRestorationProps = useRestoreFocusTarget();

  return (
    <Menu positioning={{ autoSize: true }}>
      <MenuTrigger>
        <MenuButton
          appearance="subtle"
          aria-label={getLabel(item)}
          className={styles.menuButton}
          icon={<MoreVerticalRegular aria-hidden={true} />}
          shape="circular"
          {...(isDialogTrigger ? focusRestorationProps : {})}
        />
      </MenuTrigger>
      <MenuPopover>
        <MenuList>{renderMenuItems(item)}</MenuList>
      </MenuPopover>
    </Menu>
  );
}

export function createMenuColumn<T = never>({
  columnId = 'actions',
  getLabel,
  headingLabel,
  isDialogTrigger,
  renderMenuItems,
}: MenuColumnOptions<T>): TableColumnDefinition<T> {
  return {
    columnId,
    compare: noopComparator,
    interactiveChildren: 'single',
    renderHeaderCell: () => <HeaderCell label={headingLabel} />,
    renderCell(item) {
      return (
        <MenuCell
          getLabel={getLabel}
          isDialogTrigger={isDialogTrigger}
          item={item}
          renderMenuItems={renderMenuItems}
        />
      );
    },
  };
}

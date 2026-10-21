// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { CSSProperties, ReactNode, RefObject } from 'react';

import { Button, Drawer, DrawerBody, DrawerHeader, Text } from '@coreai-ds/react-components';
import { DismissFilled, DismissRegular, bundleIcon } from '@fluentui/react-icons';
import { clsx } from 'clsx';
import { useId } from 'react';

import { useContainerQuery } from '../hooks/useContainerQuery';
import styles from './PanelLayouts.module.css';

const CloseIcon = bundleIcon(DismissFilled, DismissRegular);

/** Controlled inline/overlay panel presentation within the app container. */
export interface ResponsivePanelProps {
  id?: string;
  title: string;
  children: ReactNode;
  position: 'start' | 'end';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  headerActions?: ReactNode;
  /** Show the inline header; defaults to true. Overlay headers always show. */
  showInlineHeader?: boolean;
  /** Element to refocus after close, Escape, or overlay dismissal. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  padding?: 'default' | 'none';
  width?: number;
  /** Nonnegative integer app-container width in pixels; defaults to 768. */
  collapseAt?: number;
}

/** Renders a labelled complementary region or modal drawer at the collapse threshold.
 * Panel padding uses portal-safe tokens; callers own state that must survive unmounts.
 */
export function ResponsivePanel({
  id,
  title,
  children,
  position,
  open,
  onOpenChange,
  headerActions,
  showInlineHeader = true,
  returnFocusRef,
  padding = 'default',
  width,
  collapseAt = 768,
}: ResponsivePanelProps) {
  const titleId = useId();
  const isOverlay = useContainerQuery(`(max-width: ${collapseAt}px)`);
  const showHeader = isOverlay || showInlineHeader;

  const close = () => {
    onOpenChange(false);
    requestAnimationFrame(() => returnFocusRef?.current?.focus());
  };

  return (
    <Drawer
      id={id}
      aria-labelledby={showHeader ? titleId : undefined}
      aria-label={showHeader ? undefined : title}
      className={clsx(
        styles.panel,
        isOverlay ? styles.overlay : styles.inline,
        !isOverlay && position === 'start' && styles.inlineSidebar,
        width !== undefined && styles.fixedWidth,
      )}
      style={width === undefined ? undefined : ({ '--panelWidth': `${width}px` } as CSSProperties)}
      type={isOverlay ? 'overlay' : 'inline'}
      role={isOverlay ? 'dialog' : 'complementary'}
      position={position}
      open={open}
      onOpenChange={(_, data) => {
        if (!data.open) close();
      }}
      separator
    >
      {showHeader ? (
        <DrawerHeader className={styles.panelHeader}>
          <Text as="h2" id={titleId} preset="heading4" foreground={1} className={styles.panelTitle}>
            {title}
          </Text>
          <div className={styles.panelActions}>
            {headerActions}
            <Button
              appearance="subtle"
              aria-label={`Close ${title}`}
              icon={<CloseIcon />}
              onClick={close}
            />
          </div>
        </DrawerHeader>
      ) : null}
      <DrawerBody className={clsx(styles.panelBody, padding === 'default' && styles.panelPadding)}>
        {children}
      </DrawerBody>
    </Drawer>
  );
}

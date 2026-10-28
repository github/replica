// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import type { ReactNode } from 'react';
import type { ButtonProps } from '@coreai-ds/react-components';

import { Button } from '@coreai-ds/react-components';
import { useId, useRef, useState } from 'react';

import { useContainerQuery } from '../hooks/useContainerQuery';
import { PageBody } from './PageBody';
import { ResponsivePanel } from './ResponsivePanel';
import styles from './PanelLayouts.module.css';

/** Left-panel content and explicit main-body spacing and scrolling. */
export interface SidebarLayoutProps {
  sidebarTitle: string;
  sidebar: ReactNode;
  header?: (sidebarTrigger: ReactNode) => ReactNode;
  /** Render a supplied mobile trigger once within custom content, or use the default toolbar. */
  children: ReactNode | ((sidebarTrigger: ReactNode) => ReactNode);
  /** Sidebar body inset; use none when sections own padding and full-width dividers. */
  sidebarPadding?: 'default' | 'none';
  sidebarWidth?: number;
  triggerLabel?: string;
  triggerIcon?: ButtonProps['icon'];
  triggerAppearance?: ButtonProps['appearance'];
  /** Use none when nesting a grid, details layout, or other inset-owning content. */
  contentPadding?: 'default' | 'none';
  /** Defaults to true; disable when descendants own scrolling. */
  scrollable?: boolean;
}

/** Presents an inline left sidebar or a button-opened drawer at narrow widths.
 * Keep persistent sidebar state in the caller because drawer content can unmount.
 */
export function SidebarLayout({
  sidebarTitle,
  sidebar,
  header,
  children,
  sidebarPadding = 'default',
  sidebarWidth,
  triggerLabel = sidebarTitle,
  triggerIcon,
  triggerAppearance,
  contentPadding = 'default',
  scrollable = true,
}: SidebarLayoutProps) {
  const isOverlay = useContainerQuery('(max-width: 1024px)');
  const [mobileOpen, setMobileOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  if (!isOverlay && mobileOpen) setMobileOpen(false);

  const iconOnly = Boolean(triggerIcon);
  const sidebarTrigger = isOverlay ? (
    <Button
      ref={triggerRef}
      icon={triggerIcon}
      appearance={triggerAppearance ?? (iconOnly ? 'subtle' : 'secondary')}
      aria-label={triggerLabel}
      title={iconOnly ? triggerLabel : undefined}
      aria-controls={mobileOpen ? panelId : undefined}
      aria-expanded={mobileOpen}
      aria-haspopup="dialog"
      onClick={() => setMobileOpen(true)}
    >
      {iconOnly ? null : triggerLabel}
    </Button>
  ) : null;
  const hasCustomTriggerPlacement = typeof children === 'function';

  return (
    <>
      {header?.(sidebarTrigger)}
      <div className={styles.layout}>
        <ResponsivePanel
          id={panelId}
          collapseAt={1024}
          title={sidebarTitle}
          position="start"
          open={!isOverlay || mobileOpen}
          onOpenChange={setMobileOpen}
          returnFocusRef={triggerRef}
          showInlineHeader={false}
          padding={sidebarPadding}
          width={sidebarWidth}
        >
          {sidebar}
        </ResponsivePanel>
        <div className={styles.main}>
          {isOverlay && !header && !hasCustomTriggerPlacement ? (
            <div className={styles.toolbar}>{sidebarTrigger}</div>
          ) : null}
          <PageBody padding={contentPadding} scrollable={scrollable}>
            {hasCustomTriggerPlacement ? children(sidebarTrigger) : children}
          </PageBody>
        </div>
      </div>
    </>
  );
}
